package app

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	Port            string
	DatabaseURL     string
	MagicLinkSecret string
	SMTPHost        string
	SMTPPort        string
	SMTPFrom        string
	SMTPUser        string
	SMTPPass        string
	CORSOrigins     string
	AuthRequired    bool
}

type App struct {
	DB     *pgxpool.Pool
	Log    *slog.Logger
	Config *Config
}
