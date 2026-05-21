# Local Data Spec

## Scope

SQLite is the local operating store for Hot Cross Buns 2. It stores mirrored Google data, local notes, settings, sync checkpoints, pending mutations, diagnostics metadata, and local-only UI preferences.

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

Hot Cross Buns 2 must add mirror tables for Google account/calendar/event state and local-only notes/settings/mutations.

Required table groups:

- Account metadata: signed-in account profile without tokens.
- Task mirrors: task lists, tasks, subtasks, tags/headings if retained.
- Calendar mirrors: calendar lists, events, recurring metadata, event instances if materialized.
- Notes: local notes and search fields.
- Settings: app, sync, selected lists/calendars, appearance, hotkeys, tray, MCP.
- Sync checkpoints: Tasks watermarks and Calendar `nextSyncToken` values.
- Pending mutations: queued task/event/note operations and retry metadata.
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

## Local Notes

Notes are local-only for v1.

Minimum fields:

- id
- title
- body
- created_at
- updated_at
- deleted_at

Future linking fields may associate notes with task ids, event ids, list ids, or calendar ids, but linked notes still remain local-only unless a future sync spec changes that.

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

