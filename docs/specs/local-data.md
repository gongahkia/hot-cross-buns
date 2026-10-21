# Local Data Spec

## Scope

SQLite is the local operating store for Hot Cross Buns 2. It stores mirrored Google data, local notes, settings, sync checkpoints, pending mutations, diagnostics metadata, and local-only UI preferences.

SQLite is not a custom cloud source of truth.

Undo selects the most recently recorded applied operation; redo selects the earliest undone operation. Both follow durable SQLite insertion order rather than timestamps, so edits recorded in the same millisecond and history restored after restart retain their dependencies. Applying a history operation and changing its history state are one transaction; a new edit discards the undone branch.

## Ownership

Only main/worker services may read or write SQLite. Renderer code must request data through typed preload APIs. Any future agent tools must route through the same domain services as UI actions.

## Schema Strategy

The current schema stores account metadata, task lists and tasks, calendars and events, scheduled task blocks, native note lists and notes, tags, settings, sync checkpoints, queued Google mutations, undo records, search-document identities, and FTS indexes. Task planning metadata and tags are stored with their task; local notes do not create Google outbox mutations. Secrets remain outside SQLite.

Task and note collections are paginated in SQL. Display reads use previews; full records are fetched explicitly for editors. Indexes support pagination, task hierarchy, and identity-based FTS maintenance. Order-only task updates do not rebuild search documents.

## Migration Rules

- Every schema change must be a numbered migration.
- Migrations must be idempotent or guarded by migration version.
- Migration tests must run against temporary SQLite databases.
- Test processes must provide an explicit temporary database root and fail if
  they attempt to open a normal development or user-profile database.
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

Imported legacy task-backed Notes additionally retain local provenance for the
source Task and Task list. That mapping is a copy/import record only; it must
prevent duplicate imports without creating a hidden Notes-to-Google sync.

Future linking fields may associate notes with task ids, event ids, list ids, or calendar ids, but linked notes still remain local-only unless a future sync spec changes that.

## Encryption And Secrets

Tokens and OAuth secrets must live in Keychain, not SQLite.

The v1 default may use unencrypted SQLite for non-secret cache data, but the security spec must remain compatible with later SQLCipher or file-level encryption. If cache encryption is added, encryption keys must live outside SQLite.

## Backup And Recovery

Settings → Data supports consistent SQLite snapshots, exporting a snapshot, daily backups with retention, opening the backup directory, and local-note recovery with an explicit confirmation phrase. Recovery restores note lists and notes only, retaining current Google credentials, sync queues, and settings. Full snapshots include device stars, list sorting, and workspace preferences. This is not a general portable archive or profile rollback UI.

Force full resync clears sync checkpoints and repulls supported Google resources. Recovery and export errors must report failure rather than a placeholder success. Unsupported MCP-token reset and destructive cache shells are absent.

## Tests

Required tests:

- fresh database migration
- repeated migration
- migration from previous schema version
- repository CRUD for tasks, events, notes, settings, checkpoints, and pending mutations
- transaction rollback on failed write
- renderer cannot import database modules
