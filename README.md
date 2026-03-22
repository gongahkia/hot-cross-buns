# TickClone

A local-first desktop task manager with optional self-hosted sync. Works fully offline; the server is only needed for multi-device synchronization.

## Architecture

```
+-------------------+       HTTPS        +-------------------+
|  Tauri Desktop    |   push / pull      |  Go Sync Server   |
|                   | -----------------> |                   |
|  Svelte 5 UI      |                    |  Echo router      |
|       |           |                    |       |           |
|  Tauri IPC        |                    |  Handlers         |
|       |           |                    |       |           |
|  +----------+     |                    |  +------------+   |
|  | SQLite   |     |                    |  | PostgreSQL |   |
|  | (WAL)    |     |                    |  |    16      |   |
|  +----------+     |                    |  +------------+   |
|       |           |                    +-------------------+
|  Sync Tracker     |
|  (sync_meta)      |
+-------------------+
```

All reads and writes happen against the local SQLite database. The sync tracker records per-field timestamps and pushes/pulls changes to the server when a connection is available.

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Desktop shell | Tauri | 2.x |
| Frontend | Svelte 5 + TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| Client DB | SQLite 3 (rusqlite, WAL mode) | 3.40+ |
| Server | Go + Echo | Go 1.22+, Echo v4 |
| Server DB | PostgreSQL | 16 |
| Auth | Passwordless magic links + HS256 JWT | -- |
| Sync | Per-field vector clocks, LWW | -- |
| Recurrence | rrule (Rust), rrule-go (Go) | latest |

## Quick Start (Development)

Prerequisites: Node.js 20+, Rust stable, Go 1.22+, Docker.

```bash
# 1. Clone and configure
git clone <repo-url> && cd cross-2
cp .env.example .env

# 2. Start PostgreSQL
docker compose up -d db

# 3. Start the sync server (runs migrations automatically)
cd services/server && go run ./cmd/server

# 4. Start the desktop app (separate terminal)
cd apps/desktop && npm install && npm run tauri dev
```

The desktop app is fully functional without the server. Skip steps 2-3 if you only need offline mode.

## Quick Start (Self-Hosting)

```bash
# Start everything (PostgreSQL + sync server)
docker compose up
```

The server listens on port 8080 by default. Configure via environment variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `DB_PASSWORD` | `changeme` | PostgreSQL password |
| `PORT` | `8080` | Server HTTP port |
| `AUTH_REQUIRED` | `false` | Enable magic-link auth |
| `MAGIC_LINK_SECRET` | -- | JWT signing key (32+ chars) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |

Point your desktop client's sync settings to `http://<host>:8080`.

## Sync Protocol

TickClone uses a per-field last-write-wins (LWW) sync protocol. Changes are tracked at field granularity -- two users editing different fields on the same task never conflict.

**Cycle:** `detect local changes -> push -> pull -> apply remote -> update last_sync_at`

```
Client A               Server               Client B
   |                      |                      |
   |-- POST /sync/push -->|                      |
   |   {deviceId, batchId,|                      |
   |    changes: [...]}   |                      |
   |<-- {accepted, conflicts}                    |
   |                      |                      |
   |                      |<-- POST /sync/pull --|
   |                      |   {deviceId,         |
   |                      |    lastSyncAt}       |
   |                      |-- {changes,       -->|
   |                      |    serverTime}       |
```

**Rules:**
- Each field (title, status, priority, etc.) carries its own timestamp in `sync_meta`.
- Last-write-wins: the change with the later timestamp is accepted; older changes are counted as conflicts.
- Pulls exclude changes originating from the requesting device.
- Multi-change pushes are wrapped in a single PostgreSQL transaction with a shared `batch_id`.
- Auto-sync interval: 60 seconds with exponential backoff on failure (max 300s).

## SMTP Configuration

Magic-link authentication requires an SMTP server. Add these to your `.env`:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=noreply@example.com
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
AUTH_REQUIRED=true
MAGIC_LINK_SECRET=change-this-to-a-32-char-secret!
```

When `AUTH_REQUIRED=false` (the default), authentication is skipped and all requests use a default local user. No SMTP setup is needed for single-user self-hosting.

## API Documentation

The sync server exposes a REST API under `/api/v1`. See:

- [API_CONVENTIONS.md](./API_CONVENTIONS.md) -- endpoint reference, error codes, rate limits
- [services/server/docs/swagger.json](./services/server/docs/swagger.json) -- OpenAPI 3.0 spec

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. Summary:

- **Git workflow:** Trunk-based. Short-lived feature branches, squash-merged into `main`.
- **Branch naming:** `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/` prefixes.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) format.
- **Testing:** `go test ./...` (server), `cargo test` (Tauri), `npm run test` (Svelte), Playwright for E2E.
- **Code style:** See [STYLE_GUIDE.md](./STYLE_GUIDE.md) and [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

## Project Structure

```
cross-2/
  apps/desktop/          Tauri 2 + Svelte 5 desktop client
  services/server/       Go Echo sync server
  schema/                Shared SQL schemas and seed data
  docker-compose.yml     PostgreSQL + server
  .env.example           Environment variable template
```

## License

See repository for license details.
