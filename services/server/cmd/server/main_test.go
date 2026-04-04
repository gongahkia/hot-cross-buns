package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns-server/internal/app"
	"github.com/gongahkia/hot-cross-buns-server/internal/database"
)

func TestNewServerRegistersCoreRoutes(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping server startup smoke test")
	}

	ctx := context.Background()
	migrationsPath := filepath.Join("..", "..", "migrations")
	if err := database.RunMigrations(dsn, migrationsPath); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	pool, err := database.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	application := &app.App{
		DB:  pool,
		Log: logger,
		Config: &app.Config{
			DatabaseURL:     dsn,
			MagicLinkSecret: "test-secret",
			CORSOrigins:     "*",
			AuthRequired:    false,
		},
	}

	server := httptest.NewServer(newServer(application))
	defer server.Close()
	defer pool.Close()
	defer func() {
		_, _ = pool.Exec(ctx, "DELETE FROM sync_log")
		_, _ = pool.Exec(ctx, "DELETE FROM task_tags")
		_, _ = pool.Exec(ctx, "DELETE FROM tasks")
		_, _ = pool.Exec(ctx, "DELETE FROM tags")
		_, _ = pool.Exec(ctx, "DELETE FROM lists")
		_, _ = pool.Exec(ctx, "DELETE FROM magic_links")
		_, _ = pool.Exec(ctx, "DELETE FROM users")
	}()

	testCases := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
	}{
		{name: "health", method: http.MethodGet, path: "/health", wantStatus: http.StatusOK},
		{name: "lists", method: http.MethodGet, path: "/api/v1/lists", wantStatus: http.StatusOK},
		{name: "magic-link", method: http.MethodPost, path: "/api/v1/auth/magic-link", body: `{"email":"local@localhost"}`, wantStatus: http.StatusOK},
		{name: "sync-pull", method: http.MethodPost, path: "/api/v1/sync/pull", body: `{}`, wantStatus: http.StatusBadRequest},
	}

	client := server.Client()

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var body io.Reader
			if tc.body != "" {
				body = strings.NewReader(tc.body)
			}

			req, err := http.NewRequest(tc.method, server.URL+tc.path, body)
			if err != nil {
				t.Fatalf("build request: %v", err)
			}
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}

			resp, err := client.Do(req)
			if err != nil {
				t.Fatalf("perform request: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tc.wantStatus {
				payload, _ := io.ReadAll(resp.Body)
				t.Fatalf("expected status %d, got %d: %s", tc.wantStatus, resp.StatusCode, string(payload))
			}
		})
	}
}
