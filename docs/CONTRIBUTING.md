# Contributing

This repo has two main execution surfaces:

- `apps/desktop` for the Tauri desktop client
- `services/server` for the Go sync server

Keep changes scoped and keep the history reviewable. For CRUD-heavy work, prefer atomic commits by subsystem so rollback is straightforward.

## Local Setup

Prerequisites:

- Node.js 20+
- Rust stable
- Go 1.22+
- Docker

Linux contributors also need Tauri system packages:

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

Desktop setup:

```bash
cd apps/desktop
npm ci
npm run tauri dev
```

Server setup:

```bash
docker compose up -d db

cd services/server
DATABASE_URL=postgres://hotcrossbuns:changeme@localhost:5432/hotcrossbuns?sslmode=disable go run ./cmd/server
```

## Required Checks Before A PR

Desktop:

```bash
cd apps/desktop
npm run check
npm test

cd src-tauri
cargo test
```

Server:

```bash
cd services/server
go test ./...
```

If you change CI, docs, or commands, make sure those files still match the commands above.

## Git And Commits

Use conventional commits:

```text
type(scope): summary
```

Examples:

- `feat(desktop): harden task CRUD and view hydration`
- `fix(server): register api routes and fail fast on invalid boot`
- `chore(repo): align ci and docs with current workflow`

Recommended scopes in this repo:

- `desktop`
- `server`
- `repo`
- `sync`
- `ci`
- `docs`

## Review Standard

Changes should hold up under technical questioning. That means:

- the docs describe what the code actually does
- commands in README/CONTRIBUTING/CI are runnable
- offline-first behavior stays intact for desktop changes
- server changes preserve the real `/api/v1` contract
- tests cover boot paths or handler paths when behavior changes materially

## Environment Variables

The root [`.env.example`](./.env.example) is the source of truth for server-side env vars.

Important ones:

- `DATABASE_URL`: required for running `services/server`
- `PORT`: optional server port override
- `AUTH_REQUIRED`: toggles local-first mode vs authenticated mode
- `MAGIC_LINK_SECRET`: needed for JWT-backed auth
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: needed only for magic-link email delivery
- `CORS_ORIGINS`: allowed server origins

Never commit real secrets.
