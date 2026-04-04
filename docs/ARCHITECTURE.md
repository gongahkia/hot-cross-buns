# Architecture

Hot Cross Buns is intentionally split into two products with different responsibilities:

- `apps/desktop` is the primary product: a local-first desktop task manager.
- `services/server` is supporting infrastructure: a self-hosted sync API for users who want multiple devices.

The architecture is designed so the desktop app remains useful without the server.

## Monorepo Structure

```text
hot-cross-buns/
  apps/desktop/
    src/                  Svelte UI, stores, and route entrypoints
    src-tauri/src/
      commands/           Tauri command surface for list/task/tag/sync/data operations
      models/             Rust-side DTOs serialized to the frontend
      services/           Recurrence, maintenance, reminders, undo support
      sync/               Sync client, change tracker, worker scaffolding
      db.rs               SQLite schema and connection setup
      lib.rs              Tauri bootstrap and command registration
  services/server/
    cmd/server/           Real server entrypoint and startup assembly
    internal/handlers/    Echo handlers for auth, lists, tasks, tags, sync
    internal/repository/  PostgreSQL data access
    internal/services/    Auth and sync domain logic
    migrations/           PostgreSQL schema migrations
```

## Desktop Runtime

High-level flow:

```text
Svelte UI
  -> store actions
  -> Tauri invoke commands
  -> Rust command handlers
  -> SQLite
```

Key properties:

- The desktop database is SQLite with WAL mode enabled.
- Startup bootstraps the local model by ensuring an Inbox exists, loading lists, and hydrating tags.
- Task views are derived from persisted local data, not transient in-memory placeholders.
- Sync configuration is also persisted locally in SQLite through a singleton `sync_settings` row.

Important desktop tables:

- `lists`
- `tasks`
- `tags`
- `task_tags`
- `sync_meta`
- `sync_settings`

The `sync_meta` table records field-level change timestamps for sync. The `sync_settings` table stores the saved server URL, auth token, device ID, auto-sync preference, and last successful sync time.

## Server Runtime

The Go server is a real API process, not a passive helper:

```text
Echo server
  -> middleware
  -> /api/v1 route group
  -> auth/list/task/tag/sync handlers
  -> repositories/services
  -> PostgreSQL
```

Key properties:

- `DATABASE_URL` is required at boot.
- Migrations run before the server starts accepting requests.
- The live startup path now registers the same `/api/v1` handlers the integration tests exercise.
- `/health` is always available.
- In local-first mode (`AUTH_REQUIRED=false`), the middleware resolves a default local user so the API can still serve a single-user desktop client without login.

## Sync Model

Current sync behavior is deliberately narrow:

- Desktop remains authoritative for day-to-day interaction.
- Manual sync is triggered from the desktop settings panel.
- Auto-sync currently runs from a frontend timer while the desktop app is open.
- Conflict handling is field-level last-write-wins based on timestamps.

Sync cycle:

```text
collect local changes
  -> push to /api/v1/sync/push
  -> pull from /api/v1/sync/pull
  -> apply remote changes locally
  -> update local sync timestamps
```

This is good enough for a solo-user, self-hosted sync story. It is not yet positioned as a collaboration platform.

## Product Boundaries

This repo is strongest when understood as:

- desktop-first
- local-first
- single-user
- optional self-hosted sync

It is not currently optimized for:

- multi-user collaboration
- mobile parity
- a wide “all productivity software” scope

Those are separate product decisions, not implicit outcomes of the current architecture.
