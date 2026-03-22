# Architecture

System architecture for TickClone, a local-first desktop task manager with optional self-hosted sync.

See also: [API_CONVENTIONS.md](./API_CONVENTIONS.md) for API details, [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for UI specs.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Desktop shell | Tauri | 2.x |
| Frontend | Svelte 5 + TypeScript | 5.x |
| Frontend styling | Tailwind CSS | 4.x |
| Client DB | SQLite 3 (via rusqlite, bundled) | 3.40+ |
| Server | Go + Echo framework | Go 1.22+, Echo v4 |
| Server DB | PostgreSQL | 16 |
| Auth | Passwordless magic links + HS256 JWT | — |
| Sync protocol | Timestamp-based LWW with per-field vector clocks | — |
| NLP date parsing | chrono-node (TypeScript) | latest |
| Recurrence engine | rrule (Rust crate), rrule-go (Go) | latest |

---

## Monorepo Structure

```
cross-2/
├── client/                         # Tauri 2 + Svelte 5 desktop client
│   ├── src/                        # Svelte frontend
│   │   ├── lib/
│   │   │   ├── components/         # Svelte components (PascalCase.svelte)
│   │   │   │   ├── Sidebar.svelte
│   │   │   │   ├── TaskList.svelte
│   │   │   │   ├── TaskDetail.svelte
│   │   │   │   ├── TaskRow.svelte
│   │   │   │   ├── CalendarView.svelte
│   │   │   │   ├── TodayView.svelte
│   │   │   │   ├── WeekView.svelte
│   │   │   │   ├── SearchBar.svelte
│   │   │   │   ├── FilterBar.svelte
│   │   │   │   ├── ContextMenu.svelte
│   │   │   │   ├── ColorPicker.svelte
│   │   │   │   ├── SyncSettings.svelte
│   │   │   │   ├── NotificationCenter.svelte
│   │   │   │   ├── ShortcutsModal.svelte
│   │   │   │   └── Onboarding.svelte
│   │   │   ├── stores/             # Svelte 5 reactive stores
│   │   │   │   ├── lists.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── tags.ts
│   │   │   │   ├── ui.ts
│   │   │   │   ├── theme.ts
│   │   │   │   ├── calendar.ts
│   │   │   │   ├── filters.ts
│   │   │   │   ├── selection.ts
│   │   │   │   ├── undo.ts
│   │   │   │   └── notifications.ts
│   │   │   ├── services/           # Business logic (no UI)
│   │   │   │   ├── nlp-date.ts
│   │   │   │   ├── shortcuts.ts
│   │   │   │   └── drag-drop.ts
│   │   │   └── types.ts            # Shared TS interfaces
│   │   ├── App.svelte
│   │   ├── app.css                 # Global CSS, theme vars, Tailwind
│   │   └── main.ts
│   ├── tests/
│   │   ├── unit/                   # Vitest component/store tests
│   │   └── e2e/                    # Playwright E2E tests
│   ├── src-tauri/                  # Rust backend (Tauri)
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── list_commands.rs
│   │   │   │   ├── task_commands.rs
│   │   │   │   └── tag_commands.rs
│   │   │   ├── models/
│   │   │   │   ├── list.rs
│   │   │   │   ├── task.rs
│   │   │   │   └── tag.rs
│   │   │   ├── services/
│   │   │   │   ├── recurrence.rs
│   │   │   │   ├── reminder.rs
│   │   │   │   ├── maintenance.rs
│   │   │   │   └── undo.rs
│   │   │   ├── sync/
│   │   │   │   ├── client.rs
│   │   │   │   ├── tracker.rs
│   │   │   │   └── worker.rs
│   │   │   ├── db.rs               # SQLite connection, migrations
│   │   │   ├── state.rs            # AppState (db, config)
│   │   │   ├── error.rs            # thiserror types
│   │   │   └── lib.rs              # Tauri command registration
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   └── rustfmt.toml
│   ├── package.json
│   ├── vite.config.ts
│   ├── svelte.config.js
│   ├── tailwind.config.ts
│   ├── vitest.config.ts
│   ├── tsconfig.json
│   └── .prettierrc
├── server/                         # Go Echo sync server
│   ├── cmd/server/
│   │   └── main.go                 # Entry point
│   ├── internal/
│   │   ├── app/
│   │   │   └── app.go              # App struct (DB pool, logger, config)
│   │   ├── database/
│   │   │   ├── pool.go             # pgxpool setup
│   │   │   ├── migrate.go          # Migration runner
│   │   │   └── queries.go          # Shared query helpers
│   │   ├── handlers/
│   │   │   ├── list_handler.go
│   │   │   ├── task_handler.go
│   │   │   ├── tag_handler.go
│   │   │   ├── auth_handler.go
│   │   │   └── sync_handler.go
│   │   ├── middleware/
│   │   │   ├── auth_middleware.go
│   │   │   ├── rate_limiter.go
│   │   │   └── validator.go
│   │   ├── models/
│   │   │   ├── list.go
│   │   │   ├── task.go
│   │   │   ├── tag.go
│   │   │   └── sync.go
│   │   ├── repository/
│   │   │   ├── list_repo.go
│   │   │   ├── task_repo.go
│   │   │   └── tag_repo.go
│   │   └── services/
│   │       ├── auth_service.go
│   │       ├── email_service.go
│   │       ├── recurrence_service.go
│   │       └── sync_service.go
│   ├── migrations/
│   │   ├── 001_init.up.sql
│   │   ├── 001_init.down.sql
│   │   ├── 002_sync_batch.up.sql
│   │   └── 003_indexes.up.sql
│   ├── Dockerfile
│   └── go.mod
├── shared/                         # Shared schemas and types
│   ├── schema/
│   │   ├── canonical.sql           # SQLite canonical schema (client)
│   │   └── seed.sql                # Dev seed data
│   └── types/
│       └── sync.ts                 # Shared sync type definitions
├── .github/
│   ├── FUNDING.yaml
│   └── workflows/
│       ├── ci.yml                  # Test + lint on PR
│       └── release.yml             # Build desktop + Docker image
├── docker-compose.yml
├── .env.example
├── .gitignore
├── ARCHITECTURE.md
├── STYLE_GUIDE.md
├── CONTRIBUTING.md
├── DESIGN_SYSTEM.md
├── API_CONVENTIONS.md
└── todo.md                         # PRD (65 tasks)
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop Client                        │
│                                                          │
│  ┌──────────────┐    invoke()    ┌───────────────────┐  │
│  │  Svelte 5 UI │ ────────────> │   Tauri Rust Core  │  │
│  │  (TypeScript) │ <──────────── │                    │  │
│  │              │    JSON resp   │  ┌──────────────┐  │  │
│  │  Stores:     │               │  │  SQLite DB    │  │  │
│  │  - lists     │               │  │  (WAL mode)   │  │  │
│  │  - tasks     │               │  └──────────────┘  │  │
│  │  - tags      │               │         │          │  │
│  │  - ui        │               │  ┌──────────────┐  │  │
│  │  - theme     │               │  │ Sync Tracker  │  │  │
│  └──────────────┘               │  │ (sync_meta)   │  │  │
│                                  │  └──────┬───────┘  │  │
│                                  └─────────┼──────────┘  │
└────────────────────────────────────────────┼─────────────┘
                                             │ HTTPS
                                   push/pull │ POST
                                             ▼
┌─────────────────────────────────────────────────────────┐
│                   Go Sync Server                         │
│                                                          │
│  ┌──────────┐   ┌────────────┐   ┌──────────────────┐  │
│  │  Echo     │──>│  Handlers  │──>│   Repository     │  │
│  │  Router   │   │            │   │                  │  │
│  │          │   │  list_      │   │  ┌────────────┐  │  │
│  │  /api/v1 │   │  task_      │   │  │ PostgreSQL │  │  │
│  │          │   │  tag_       │   │  │    16      │  │  │
│  │ middleware│   │  auth_      │   │  │            │  │  │
│  │  - auth  │   │  sync_      │   │  │ - users    │  │  │
│  │  - rate  │   │             │   │  │ - lists    │  │  │
│  │  - log   │   └────────────┘   │  │ - tasks    │  │  │
│  └──────────┘                     │  │ - sync_log │  │  │
│                                   │  └────────────┘  │  │
│                                   └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Sync Protocol

```
Client A              Server              Client B
   │                    │                    │
   │── POST /sync/push ─>│                    │
   │   {changes: [...]}  │                    │
   │<── {accepted: N} ───│                    │
   │                    │                    │
   │                    │<── POST /sync/pull ─│
   │                    │   {lastSyncAt: T}   │
   │                    │── {changes: [...]} ─>│
   │                    │                    │
```

**Rules:**
- Per-field granularity: each field (title, status, priority, etc.) has its own timestamp in `sync_meta`
- Last-write-wins: the change with the later timestamp always wins
- Device exclusion: pulls exclude changes originating from the requesting device
- Batch atomicity: multi-change pushes wrapped in a PostgreSQL transaction with a shared `batch_id`
- Sync cycle: `get_pending_changes → push → pull → apply_remote_changes → update last_sync_at`
- Auto-sync interval: 60s with exponential backoff on failure (2s → 4s → 8s → ... → max 300s)

---

## Data Models

```
users 1──* lists 1──* tasks *──* tags
                        │
                        └──* tasks (subtasks, depth=1)
```

**Constraints:**
- All IDs: UUIDv7 (time-ordered)
- Soft deletes: `deleted_at` column, purged after 30 days
- Subtask depth: max 1 level (no nested subtasks)
- Priority: `0`=none, `1`=low, `2`=medium, `3`=high
- Status: `0`=open, `1`=completed
- Timestamps: ISO 8601 TEXT in SQLite, TIMESTAMPTZ in PostgreSQL
- Recurrence: RFC 5545 RRULE strings (e.g., `FREQ=WEEKLY;BYDAY=MO,WE,FR`)
- Tags are user-scoped, linked via `task_tags` junction table
- Each user gets one auto-created Inbox list (`is_inbox = true`, cannot be deleted)

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Local-first | App is fully functional offline; server is optional |
| SQLite WAL mode | Allows concurrent reads during sync writes |
| Tauri IPC boundary | All DB access through Rust commands, never directly from TypeScript |
| Optional auth (`AUTH_REQUIRED` flag) | Local-only users skip server entirely; server can run unauthenticated for single-user self-host |
| Custom UI components (no library) | Full control over Catppuccin theming and compact density; no dependency conflicts |
| Tailwind CSS | Utility-first matches component-per-file architecture; design tokens via CSS variables |
| Per-field sync (not row-level) | Minimizes conflicts — two users editing different fields on the same task don't conflict |
| UUIDv7 (not auto-increment) | Globally unique, time-ordered, generated client-side without server roundtrip |
| Soft deletes with 30-day purge | Recovery window for users; prevents unbounded storage growth |
| HS256 JWT (not RS256) | Single server, no key rotation needed for MVP; simpler |
