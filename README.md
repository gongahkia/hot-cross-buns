# Hot Cross Buns

Hot Cross Buns is a desktop-first, local-first task manager. The desktop app owns the primary experience: lists, tasks, tags, planning views, and persistence all work against a local SQLite database. The Go server exists to support optional self-hosted sync between devices.

## Current Scope

- Offline-first desktop app built with Tauri + Svelte
- Local SQLite persistence for lists, tasks, tags, recurrence, and sync metadata
- Planning views for list, today, week, and calendar workflows
- Optional self-hosted sync server built with Echo + PostgreSQL
- Persisted sync settings on desktop (`serverUrl`, `authToken`, `deviceId`, `autoSyncEnabled`, `lastSyncedAt`)

Current non-goals for this repo:

- Collaboration and shared workspaces
- Mobile clients
- Broad adjacent features like habits, docs, or notes systems

## Repo Layout

```text
hot-cross-buns/
  apps/desktop/      Tauri desktop app (Svelte frontend + Rust commands)
  services/server/   Go sync server
  schema/            Reference SQL schema files
  docker-compose.yml Local PostgreSQL + server stack
```

## Prerequisites

- Node.js 20+
- Rust stable
- Go 1.22+
- Docker

Linux desktop builds also need the usual Tauri system packages:

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

## Run The Desktop App

The desktop app does not need the sync server to be useful.

```bash
cd apps/desktop
npm ci
npm run tauri dev
```

Useful desktop verification commands:

```bash
cd apps/desktop
npm run check
npm test

cd src-tauri
cargo test
```

## Run The Sync Server

The server now requires `DATABASE_URL` at boot.

```bash
docker compose up -d db

cd services/server
DATABASE_URL=postgres://hotcrossbuns:changeme@localhost:5432/hotcrossbuns?sslmode=disable go run ./cmd/server
```

Server verification:

```bash
cd services/server
go test ./...
```

If you prefer the full stack through Docker:

```bash
docker compose up --build
```

## Environment

The root [`.env.example`](./.env.example) contains the server-side environment variables used by Docker and local server runs.

Important variables:

- `DATABASE_URL`: required for `services/server`
- `PORT`: HTTP port for the sync server
- `AUTH_REQUIRED`: when `false`, the server runs in local-first single-user mode
- `MAGIC_LINK_SECRET`: required if you want JWT-backed authenticated sessions
- `SMTP_*`: required only when you actually want magic-link email delivery

## Product Notes

- The desktop app always reads and writes locally first.
- Sync is optional and configured from the desktop settings panel.
- Manual sync uses the saved sync settings.
- Auto-sync currently runs from a frontend timer while the desktop app is open.
- The server exposes REST endpoints under `/api/v1` and a health check at `/health`.

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [API_CONVENTIONS.md](./API_CONVENTIONS.md)
- [apps/desktop/README.md](./apps/desktop/README.md)
