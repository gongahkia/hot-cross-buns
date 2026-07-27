# Local Data Spec

## Scope

SQLite is the local cache, settings store, sync checkpoint store, pending mutation journal, search index, and reminder-state store. It is not a cloud source of truth; Google Calendar and Google Tasks remain authoritative for synced rows.

## Ownership

Only C++ services and their queues read or write SQLite. Qt Quick receives bounded DTOs through models and invokes `AppController`; it cannot access database files, credentials, or Google HTTP clients.

## Required data groups

- account metadata without credentials
- Google Task lists, tasks, hierarchy, notes projection data, and recurrence markers
- Google Calendar lists, event masters, resolved instances, recurrence lines, visibility, reminders, invites, and status-event data
- settings for presentation, selected resources, conflict policy, and note projection
- sync checkpoints and durable pending mutations
- local reminder delivery/snooze/dismiss state
- indexed local search data and sanitized diagnostics metadata

## Rules

- Every schema change is a numbered, tested migration.
- Use parameterized SQL, prepared statements, indexed range/page reads, and transactions for mirror-plus-mutation writes.
- Do not interpolate QML or Google input into SQL.
- Persist all-day values as stable ISO dates and timed values as explicit ISO instants with timezone fields where needed.
- Notes remain undated root Google Tasks; no separate remote notes model exists.
- Credentials live in macOS Keychain, not SQLite.
- Destructive recovery controls need explicit confirmation and must preserve actionable error state.

## Tests

- fresh/repeated/upgrade migration paths
- transaction rollback and write failures
- task/event/note/search/reminder repository behavior
- pending mutation and sync checkpoint consistency
- no credentials in the database or UI DTOs
