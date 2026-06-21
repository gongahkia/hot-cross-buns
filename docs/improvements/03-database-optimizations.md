# Database Optimization Improvements

## Comparison Basis

Legacy reference repo:

- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Persistence/LocalCacheDatabaseStore.swift`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/schema/canonical.sql`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/LocalCacheDatabaseStoreTests.swift`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsMacTests/LargeAccountCalendarPerformanceTests.swift`

Current Electron rebuild:

- `src/main/data/sqliteConnection.ts`
- `src/main/data/migrations.ts`
- `src/main/data/localRepositories.ts`
- `src/main/sync/readSyncRepository.ts`

Hot Cross Buns 2 already uses SQLite, WAL, FTS5, local migrations, indexed Google mirror tables, pending mutations, checkpoints, and query timing diagnostics. The main gap is that the current connection is a Python subprocess bridge and the database lacks the legacy app's richer derived indexes, persistent prepared statements, incremental apply profiles, and repair paths.

## Status - 2026-05-22 SQLite Adapter Pass

Implemented in this pass:

- `src/main/data/sqliteConnection.ts` now uses `better-sqlite3` as the primary main-process adapter while preserving the repository-facing synchronous `SqliteConnection` methods.
- The Python subprocess bridge is contained as `python-subprocess-compat` fallback only when the native binding is missing or built for the wrong Electron ABI.
- Production pragmas are applied by the native adapter: foreign keys, WAL, synchronous normal, temp store memory, cache size, mmap size, and busy timeout. The compatibility fallback initializes durable WAL once and applies connection-local pragmas per subprocess command.
- The connection exposes `prepare(sql)` and caches native prepared statements by SQL string, so repeated repository reads/writes do not rebuild statements in the primary adapter.
- Tests now cover migrations, production pragmas after reopen, explicit prepared statements, FTS queries, transaction rollback on injected failure, and static package compatibility metadata.
- Build packaging metadata externalizes `better-sqlite3`, enables native rebuild, unpacks `better_sqlite3.node`, and allows the documented native external in bundle review.

Measured `pnpm test:perf` direct SQLite delta against the pre-change Python bridge baseline:

| Measurement | Before | After | Status |
|---|---:|---:|---|
| `fixtures.seed-medium-sqlite` | 2768.22ms | 81.65ms | Improved |
| `sqlite.task-lists.medium` | 275.86ms | 0.9ms | Improved |
| `sqlite.tasks.active-list.medium` | 273.83ms | 0.71ms | Improved |
| `sqlite.events.visible-range.medium` | 271.6ms | 1.31ms | Improved |
| `sqlite.notes.recent.medium` | 271.16ms | 0.19ms | Improved |
| `search.medium-local` | 277.82ms | 3.58ms | Improved |
| `sqlite.checkpoint.read` | 88.58ms | 0.05ms | Improved |
| `sqlite.pending-mutations.ready` | 90.82ms | 0.03ms | Improved |

Remaining data-path blockers:

- The local unpackaged Electron perf run still used the compatibility fallback because the installed `better-sqlite3` binary was built for host Node ABI 141 while Electron expected ABI 130. `electron-builder` is configured to rebuild/unpack the native module, but a packaged preview smoke must prove the native adapter is used in the `.app`.
- Startup timings in the same perf run therefore remain blocked: cold shell visible 6270ms and cached render 10733ms; warm shell visible 6799ms and cached render 13293ms.
- Derived render tables, content-hash skip logic, incremental apply profiles, and repair/maintenance paths remain future work.

## Improvements To Add

### 1. Replace The Python SQLite Bridge

Current `SqliteConnection` shells to `python3 -c` for every SQLite command. That is simple and portable for early development, but it adds process startup overhead and prevents prepared statement reuse.

Move main-process persistence to a native Node SQLite binding such as `better-sqlite3` or Node's built-in SQLite API if the runtime version supports the required synchronous APIs. Keep the existing `SqliteConnection` interface so repositories and tests remain mostly unchanged.

Acceptance checks:

- Existing SQLite unit tests pass without Python.
- A temporary database can run migrations, writes, transactions, FTS queries, and diagnostics.
- Query timing improves in the performance smoke fixture.
- Electron packaging includes the native module correctly on macOS.

### 2. Apply Production SQLite Pragmas

Legacy configures WAL, foreign keys, `synchronous=NORMAL`, `temp_store=MEMORY`, negative `cache_size`, and `mmap_size`.

Apply a consistent connection bootstrap in the new SQLite adapter:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65536;
PRAGMA mmap_size = 268435456;
PRAGMA busy_timeout = 30000;
```

Acceptance checks:

- Tests assert the important pragmas on a live connection.
- WAL mode remains enabled after reopening the database.
- Read and write transactions continue to roll back atomically on failure.

### 3. Add Prepared Statements For Hot Paths

Legacy uses GRDB's persistent database queue and prepared statements for repeated inserts and derived table rebuilds.

Add prepared statement support behind the `SqliteConnection` interface or repository-local helpers. Target hot paths first: task list reads, task reads, calendar range reads, note search, Google sync upserts, pending mutation selection, and diagnostics counts.

Acceptance checks:

- Repository methods do not rebuild SQL statements for every row in bulk sync.
- Bulk sync fixture records lower total SQLite duration.
- Prepared statement resources are closed on app shutdown.

### 4. Add Derived Render Tables

Legacy maintains `cache_task_render_index`, `cache_event_render_index`, calendar event day/range tables, color/tag counts, and range revision tables.

Add derived tables for renderer-ready projections:

- task render index: title, status, due date, list, priority, parent, deletion/hidden flags, updated time
- event render index: title, start/end, all-day, calendar, status, location, attendees/reminders summaries
- calendar day index: one row per event/day overlap for fast month/year grids
- sidebar/count tables: selected list/calendar counts and color/tag counts where needed
- revision rows: cheap invalidation keys for calendar ranges and task groups

Acceptance checks:

- Calendar month/year reads do not scan all events for large accounts.
- Task counts do not require repeated aggregate joins over full task tables.
- Derived rows rebuild from source tables after migration or repair.

### 5. Add Incremental Apply And Content Hash Skips

Legacy stores content hashes and skips unchanged rows during incremental sync application.

Add content hashes to synced mirror rows or a side table for task lists, tasks, calendars, events, checkpoints, and pending mutations. During read sync, compare incoming normalized payload hashes before writing. Record apply profiles with inserted, updated, deleted, unchanged skipped, transaction time, and total time.

Acceptance checks:

- Replaying the same Google page produces mostly skipped rows.
- Diagnostics can show last apply profile counts.
- Hash comparison does not skip local optimistic fields that must be preserved.

### 6. Add Repair And Maintenance Paths

Legacy exposes repair methods for search/render tables and derived calendar indexes.

Add main-process maintenance actions:

- rebuild FTS tables
- rebuild render indexes
- rebuild calendar day/range indexes
- run `ANALYZE` after large syncs
- checkpoint WAL on clean shutdown or after large imports

Expose these only through Settings recovery/diagnostics actions, not renderer direct filesystem access.

Acceptance checks:

- Repair actions are idempotent.
- Repair actions produce diagnostics timing rows.
- Failed repair shows a recoverable settings error.

## Recommended Starting Point

Start with replacing the Python SQLite bridge while preserving the current `SqliteConnection` interface. That change unlocks prepared statements and makes later derived-index work measurable.
