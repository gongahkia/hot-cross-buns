package handlers

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/gongahkia/cross-2-server/internal/app"
	"github.com/gongahkia/cross-2-server/internal/services"
)

// AuthHandler holds dependencies for authentication HTTP handlers.
type AuthHandler struct {
	App          *app.App
	AuthService  *services.AuthService
	EmailService *services.EmailService
}

type magicLinkRequest struct {
	Email string `json:"email"`
}

type verifyRequest struct {
	Token string `json:"token"`
}

type verifyResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

// RegisterRoutes registers the authentication routes on the given Echo group.
func (h *AuthHandler) RegisterRoutes(g *echo.Group) {
	g.POST("/auth/magic-link", h.RequestMagicLink)
	g.POST("/auth/verify", h.VerifyMagicLink)
}

// RequestMagicLink handles POST /api/v1/auth/magic-link.
// It always returns the same response to prevent email enumeration.
func (h *AuthHandler) RequestMagicLink(c echo.Context) error {
	var req magicLinkRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusOK, map[string]string{
			"message": "If that email is registered, a link has been sent.",
		})
	}

	if req.Email == "" {
		return c.JSON(http.StatusOK, map[string]string{
			"message": "If that email is registered, a link has been sent.",
		})
	}

	if h.App.DB == nil {
		slog.Warn("magic link requested but database is not configured")
		return c.JSON(http.StatusOK, map[string]string{
			"message": "If that email is registered, a link has been sent.",
		})
	}

	token, err := h.AuthService.GenerateMagicLink(c.Request().Context(), h.App.DB, req.Email)
	if err != nil {
		slog.Error("failed to generate magic link", "error", err, "email", req.Email)
		return c.JSON(http.StatusOK, map[string]string{
			"message": "If that email is registered, a link has been sent.",
		})
	}

	// Send the email in the background; do not block the response.
	cfg := h.App.Config
	if cfg.SMTPHost != "" {
		go func() {
			if err := h.EmailService.SendMagicLink(req.Email, token, cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPFrom, cfg.SMTPUser, cfg.SMTPPass); err != nil {
				slog.Error("failed to send magic link email", "error", err, "email", req.Email)
			}
		}()
	} else {
		slog.Warn("SMTP not configured, magic link not emailed", "token", token)
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "If that email is registered, a link has been sent.",
	})
}

// VerifyMagicLink handles POST /api/v1/auth/verify.
// It validates the magic link token and returns a JWT session token.
func (h *AuthHandler) VerifyMagicLink(c echo.Context) error {
	var req verifyRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "invalid request body",
		})
	}

	if req.Token == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "token is required",
		})
	}

	if h.App.DB == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "database not configured",
		})
	}

	userID, err := h.AuthService.ValidateMagicLink(c.Request().Context(), h.App.DB, req.Token)
	if err != nil {
		slog.Error("failed to validate magic link", "error", err)
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "invalid or expired token",
		})
	}

	jwtToken, err := h.AuthService.GenerateSessionToken(userID, h.App.Config.MagicLinkSecret)
	if err != nil {
		slog.Error("failed to generate session token", "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to generate session token",
		})
	}

	expiresAt := time.Now().UTC().Add(30 * 24 * time.Hour).Format(time.RFC3339)

	return c.JSON(http.StatusOK, verifyResponse{
		Token:     jwtToken,
		ExpiresAt: expiresAt,
	})
}
