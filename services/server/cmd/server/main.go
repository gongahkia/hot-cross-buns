package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/gongahkia/cross-2-server/internal/app"
	"github.com/gongahkia/cross-2-server/internal/database"
	"github.com/gongahkia/cross-2-server/internal/handlers"
	authmw "github.com/gongahkia/cross-2-server/internal/middleware"
	"github.com/gongahkia/cross-2-server/internal/repository"
	"github.com/gongahkia/cross-2-server/internal/services"
)

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return fallback
}

func loadConfig() *app.Config {
	return &app.Config{
		Port:            getEnv("PORT", "8080"),
		DatabaseURL:     getEnv("DATABASE_URL", ""),
		MagicLinkSecret: getEnv("MAGIC_LINK_SECRET", ""),
		SMTPHost:        getEnv("SMTP_HOST", ""),
		SMTPPort:        getEnv("SMTP_PORT", "587"),
		SMTPFrom:        getEnv("SMTP_FROM", ""),
		SMTPUser:        getEnv("SMTP_USER", ""),
		SMTPPass:        getEnv("SMTP_PASS", ""),
		CORSOrigins:     getEnv("CORS_ORIGINS", "http://localhost:1420"),
		AuthRequired:    getEnv("AUTH_REQUIRED", "false") == "true",
	}
}

// ensureDefaultLocalUser creates the default local user (local@localhost) if
// it does not already exist. This is called once at server boot when running
// in local-first single-user mode (AUTH_REQUIRED=false).
func ensureDefaultLocalUser(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
		"local@localhost",
	)
	return err
}

func newServer(application *app.App) *echo.Echo {
	e := echo.New()
	e.HideBanner = true

	e.Use(middleware.Recover())
	e.Use(middleware.SecureWithConfig(middleware.SecureConfig{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ReferrerPolicy:        "strict-origin-when-cross-origin",
		ContentSecurityPolicy: "default-src 'self'",
	}))
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: strings.Split(application.Config.CORSOrigins, ","),
	}))
	e.Use(authmw.AuthMiddleware(
		application.Config.MagicLinkSecret,
		application.DB,
		application.Config.AuthRequired,
	))
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			slog.Info("request",
				"method", c.Request().Method,
				"path", c.Request().URL.Path,
				"status", c.Response().Status,
				"latency_ms", time.Since(start).Milliseconds(),
			)
			return err
		}
	})

	e.Use(authmw.PathRateLimiterMiddleware(authmw.GeneralRateLimit, []authmw.PathRateLimit{
		{PathPrefix: "/api/v1/auth/", Config: authmw.AuthRateLimit},
		{PathPrefix: "/api/v1/sync/", Config: authmw.SyncRateLimit},
	}))

	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	api := e.Group("/api/v1")

	authHandler := &handlers.AuthHandler{
		App:          application,
		AuthService:  &services.AuthService{},
		EmailService: &services.EmailService{},
	}
	authHandler.RegisterRoutes(api)

	handlers.NewListHandler(api, application)

	taskHandler := handlers.NewTaskHandler(application.DB, repository.NewTaskRepository())
	taskHandler.RegisterTaskRoutes(api)

	handlers.NewTagHandler(api, application.DB)

	syncHandler := handlers.NewSyncHandler(application.DB)
	syncHandler.RegisterSyncRoutes(api)

	return e
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := loadConfig()

	if cfg.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	// Run migrations
	migrationsPath := getEnv("MIGRATIONS_PATH", "migrations")
	if err := database.RunMigrations(cfg.DatabaseURL, migrationsPath); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	// Create DB pool
	ctx := context.Background()
	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	application := &app.App{DB: pool, Log: logger, Config: cfg}

	// In local-first mode, ensure the default user exists on boot.
	if !cfg.AuthRequired {
		if err := ensureDefaultLocalUser(ctx, application.DB); err != nil {
			slog.Error("failed to create default local user", "error", err)
			os.Exit(1)
		}
		slog.Info("local-first mode enabled, default user ensured", "email", "local@localhost")
	}

	e := newServer(application)

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		addr := fmt.Sprintf(":%s", cfg.Port)
		slog.Info("starting server", "addr", addr)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCtx.Done()
	slog.Info("shutting down server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}
	slog.Info("server stopped")
}
