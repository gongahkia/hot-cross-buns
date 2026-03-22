package middleware

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

const defaultLocalEmail = "local@localhost"

// defaultUser caches the local-mode user ID so it is resolved at most once.
var (
	defaultUserOnce sync.Once
	defaultUserID   string // UUID string
	defaultUserErr  error
)

// ensureDefaultUser finds or creates the default local user and caches the ID.
func ensureDefaultUser(pool *pgxpool.Pool) (string, error) {
	defaultUserOnce.Do(func() {
		var id string
		err := pool.QueryRow(context.Background(),
			`INSERT INTO users (email) VALUES ($1)
			 ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
			 RETURNING id`,
			defaultLocalEmail,
		).Scan(&id)
		if err != nil {
			defaultUserErr = fmt.Errorf("ensure default local user: %w", err)
			return
		}
		defaultUserID = id
		slog.Info("local-first mode: default user ready", "userID", id, "email", defaultLocalEmail)
	})
	return defaultUserID, defaultUserErr
}

// AuthMiddleware returns an Echo middleware that validates JWT Bearer tokens
// in the Authorization header. It sets "userID" in the Echo context on success.
// Requests to /api/v1/auth/* and /health are skipped.
//
// When authRequired is false (local-first single-user mode) and no Bearer token
// is provided, the middleware auto-resolves a default local user (local@localhost)
// and injects its ID into the context. If a Bearer token IS provided in this mode,
// the token is validated normally.
func AuthMiddleware(secret string, pool *pgxpool.Pool, authRequired bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path

			// Skip authentication for auth endpoints and health check.
			if strings.HasPrefix(path, "/api/v1/auth/") || path == "/health" {
				return next(c)
			}

			authHeader := c.Request().Header.Get("Authorization")

			// Local-first mode: if no token is provided, use the default user.
			if !authRequired && authHeader == "" {
				if pool == nil {
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "database not configured for local mode",
					})
				}
				userID, err := ensureDefaultUser(pool)
				if err != nil {
					slog.Error("failed to resolve default local user", "error", err)
					return c.JSON(http.StatusInternalServerError, map[string]string{
						"error": "failed to resolve local user",
					})
				}
				c.Set("userID", userID)
				return next(c)
			}

			// From here on, a token must be present (either auth is required,
			// or the caller chose to send one in local mode).
			if authHeader == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "missing authorization header",
				})
			}

			if !strings.HasPrefix(authHeader, "Bearer ") {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid authorization header format",
				})
			}

			tokenString := strings.TrimPrefix(authHeader, "Bearer ")

			token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(secret), nil
			})
			if err != nil || !token.Valid {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid or expired token",
				})
			}

			subject, err := token.Claims.GetSubject()
			if err != nil || subject == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{
					"error": "invalid token claims",
				})
			}

			c.Set("userID", subject)

			return next(c)
		}
	}
}
