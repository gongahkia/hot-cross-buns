package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuthService handles authentication operations including magic link
// generation, validation, and JWT session token creation.
type AuthService struct{}

// GenerateMagicLink finds or creates a user by email, generates a
// cryptographically random token, and stores it in the magic_links table
// with a 15-minute expiry.
func (s *AuthService) GenerateMagicLink(ctx context.Context, pool *pgxpool.Pool, email string) (string, error) {
	// Find or create the user by email.
	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email) VALUES ($1)
		 ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		 RETURNING id`,
		email,
	).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("find or create user: %w", err)
	}

	// Generate a 32-byte cryptographically random token.
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}
	token := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(tokenBytes)

	// Insert the magic link record with a 15-minute expiry.
	expiresAt := time.Now().UTC().Add(15 * time.Minute)
	_, err = pool.Exec(ctx,
		`INSERT INTO magic_links (user_id, token, expires_at) VALUES ($1, $2, $3)`,
		userID, token, expiresAt,
	)
	if err != nil {
		return "", fmt.Errorf("insert magic link: %w", err)
	}

	return token, nil
}

// ValidateMagicLink looks up an unused, unexpired magic link token and marks
// it as used. Returns the associated user ID.
func (s *AuthService) ValidateMagicLink(ctx context.Context, pool *pgxpool.Pool, token string) (uuid.UUID, error) {
	var userID uuid.UUID
	err := pool.QueryRow(ctx,
		`UPDATE magic_links
		 SET used_at = now()
		 WHERE token = $1
		   AND used_at IS NULL
		   AND expires_at > now()
		 RETURNING user_id`,
		token,
	).Scan(&userID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("validate magic link: %w", err)
	}

	return userID, nil
}

// GenerateSessionToken creates an HS256-signed JWT containing the user ID
// as the subject claim, with a 30-day expiry.
func (s *AuthService) GenerateSessionToken(userID uuid.UUID, secret string) (string, error) {
	now := time.Now().UTC()
	claims := jwt.RegisteredClaims{
		Subject:   userID.String(),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(30 * 24 * time.Hour)),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("sign jwt: %w", err)
	}

	return signed, nil
}
