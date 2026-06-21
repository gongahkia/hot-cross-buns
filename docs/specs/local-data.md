# Local Data Spec

## Scope

SQLite is the local operating store for Hot Cross Buns 2. It stores mirrored Google data, settings, sync checkpoints, pending mutations, diagnostics metadata, and local-only UI preferences.

SQLite is not a custom cloud source of truth.

## Ownership

Only main/worker services may read or write SQLite. Renderer code must request data through typed preload APIs. MCP tools must route through the same domain services as UI actions.

## Schema Strategy

Start from the existing Hot Cross Buns canonical SQLite model:

- `areas`
- `lists`
- `tasks`
- `tags`
- `task_tags`
- `headings`
- `sync_meta`

Hot Cross Buns 2 must add mirror tables for Google account/task/calendar/event state plus settings and mutations.

Required table groups:

- Account metadata: signed-in account profile without tokens.
- Task mirrors: task lists, tasks, subtasks, tags/headings if retained.
- Calendar mirrors: calendar lists, events, recurring metadata, event instances if materialized.
- Scheduled task blocks: local links between Google Tasks and the Google Calendar events that time-block them.
- Notes: task-backed note projections and search fields.
- Settings: app, sync, selected lists/calendars, appearance, hotkeys, tray, MCP.
- Sync checkpoints: Tasks watermarks and Calendar `nextSyncToken` values.
- Pending mutations: queued task/event/task-backed-note operations and retry metadata.
- Diagnostics metadata: sanitized sync, MCP, and migration state.

## Migration Rules

- Every schema change must be a numbered migration.
- Migrations must be idempotent or guarded by migration version.
- Migration tests must run against temporary SQLite databases.
- Failed migrations must not leave partially upgraded state without an error marker.
- Destructive migrations require a backup/export path first.

## Data Access Rules

- Do not build SQL strings from renderer input.
- Use parameterized statements only.
- Keep repositories focused by domain.
- Wrap multi-step writes in transactions.
- Return DTOs rather than raw database rows.
- Normalize dates as ISO strings with explicit timezone fields where needed.

## Task-Backed Notes

Notes are stored as Google Tasks rows.

Note rows are active, non-hidden, non-completed, root tasks with no due date. Note lists map to Google Tasks lists.

No separate local SQLite note tables should be created.

## Encryption And Secrets

Tokens and OAuth secrets must live in Keychain, not SQLite.

The v1 default may use unencrypted SQLite for non-secret cache data, but the security spec must remain compatible with later SQLCipher or file-level encryption. If cache encryption is added, encryption keys must live outside SQLite.

## Backup And Recovery

Settings must eventually support:

- copy diagnostics summary
- clear local Google cache and resync
- force full resync by clearing checkpoints
- export portable local data where safe
- reset MCP token

Do not provide a destructive data control without a confirmation step.

## Tests

Required tests:

- fresh database migration
- repeated migration
- migration from previous schema version
- repository CRUD for tasks, events, notes, settings, checkpoints, and pending mutations
- transaction rollback on failed write
- renderer cannot import database modules

## Current Implementation Notes

- SQLite repositories now back the core task, task-list, calendar-event, task-backed note, settings, search, sync-status, and performance-timing paths exposed through typed IPC.
- UI IPC handlers and MCP tools share the same main-side domain services. Synced task, note, and event writes update local mirrors and enqueue `google_pending_mutations` only when Google is the active backend; HCB local vault and hoster modes keep writes local.
- HCB hoster mode uses encrypted `.hcbvault` snapshot push/pull for a trusted local server/Raspberry Pi/another laptop. Settings and CLI clients can check host status, push the current encrypted vault, or pull a hosted vault after confirmation. Optional saved vault-host credentials live in OS credential storage and let Refresh/scheduled sync push the encrypted vault through `sync.runNow`. The remote host stores encrypted packages, not Google polling state, OAuth credentials, or plaintext planner rows. v1 snapshot pull is destructive and does not merge concurrent writers.
- Scheduled task blocks are local metadata rows that link a task to a real queued Google Calendar event, preserving Google Tasks as date-only while making the Today timeline movable. Active block listing reconciles against the linked Calendar event, marks missing/cancelled event links as orphaned, and uses the live event range when Google was edited externally.
- Local search reads current task, event, and note rows from SQLite with capped results and indexed recent/search paths. Renderer search requests stay bounded and do not call Google.
- The renderer receives DTOs only. It does not import SQLite modules, raw Google payloads, tokens, filesystem internals, or unbounded result sets.
