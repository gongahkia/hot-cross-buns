# Main, IPC, And Data Performance

Hot Cross Buns uses Electron main/preload/renderer boundaries. The main process is responsible for app lifecycle and native integration, so it must avoid becoming a shared bottleneck.

## Main Process Rules

- Register IPC, app menus, tray, shortcuts, and windows quickly.
- Defer remote sync, update checks, MCP startup, deep diagnostics, and expensive indexing until after first interactive render.
- Keep long operations cancellable or queued.
- Move blocking CPU or IO work to workers or utility processes when it can affect input responsiveness.
- Treat sync and database jobs as background work with progress/status events.

Electron's process model supports utility processes for CPU-intensive or crash-prone work. Use that option when a service cannot remain cheap in the main process.

## IPC Rules

- IPC payloads should be bounded and shaped for the view.
- Prefer page/range queries over returning full collections.
- Prefer explicit subscriptions or invalidation events over polling the same large payload.
- Use stable DTOs that preserve unchanged object identity where the renderer cache can benefit.
- Do not send raw Google payloads to renderer code.
- Do not send secrets, tokens, filesystem internals, or full diagnostics over normal UI IPC.

## SQLite Rules

- Use parameterized statements.
- Add indexes for every primary read path before large fixtures are introduced.
- Validate core queries with `EXPLAIN QUERY PLAN`.
- Avoid full table scans on large task/event/search surfaces unless the table is proven tiny.
- Use transactions for multi-step writes.
- Keep write transactions short.
- Use pagination or range windows for large lists.
- Store precomputed fields when they prevent repeated expensive transforms in common views.

Core query families that need indexes:

- incomplete tasks by list, status, due date, and sort order
- subtasks by parent task id
- events by calendar id and visible start/end range
- notes by updated date and search fields
- pending mutations by status, next retry time, and resource type
- sync checkpoints by account/resource

## SQLite Adapter Measurements - 2026-05-22

The Python subprocess bridge has been replaced on the primary Node/main-process path with `better-sqlite3`, production pragmas, and cached prepared statements. A Python subprocess compatibility adapter remains only for missing or ABI-mismatched native bindings.

`pnpm test:perf` direct SQLite timings improved sharply on the medium fixture:

| Measurement | Python bridge baseline | Native adapter | Result |
|---|---:|---:|---|
| Seed medium SQLite fixture | 2768.22ms | 81.65ms | Improved |
| Task lists | 275.86ms | 0.9ms | Improved |
| Active tasks by list | 273.83ms | 0.71ms | Improved |
| Visible calendar range | 271.6ms | 1.31ms | Improved |
| Recent notes | 271.16ms | 0.19ms | Improved |
| Local search | 277.82ms | 3.58ms | Improved |
| Checkpoint read | 88.58ms | 0.05ms | Improved |
| Pending mutations ready | 90.82ms | 0.03ms | Improved |

2026-05-23 perf smoke after deferring Google status and deep diagnostics from first render: cold shell visible 435ms, cold cached render 486ms, warm shell visible 256ms, warm cached render 339ms, command palette 18-19ms, task completion feedback 53-70ms, and Search UI 38.97ms cold / 34.07ms warm. Electron IPC routes stayed on the native adapter (`settings.get` ~0.1ms, task list reads ~1-2ms, calendar range reads ~2-3ms, local search ~3ms). The remaining soft performance watch is cold cached-render-after-database-open at 375ms against the 300ms target.

The same smoke intentionally rebuilt the local native module for Electron ABI 130 before launch, so Node-side direct SQLite measurements in that run used the Python compatibility fallback and were slow. The release gate should keep both checks: Node ABI tests prove local developer/unit-test behavior, and Electron/package smoke proves the actual app runtime does not fall back to Python.

2026-05-24 local perf smoke without a working Electron-ABI native runtime showed the opposite split: direct Node-side SQLite stayed fast (`settings`-adjacent SQLite query families under a few ms, local search ~2.86ms), but app IPC timings indicated the Electron runtime was on the compatibility path (`settings.get` ~678ms, task/calendar reads ~76-99ms, schedule suggestions ~158ms). In that environment shell visible was roughly 3.3-3.5s and cached render 7.6-9.3s, so those startup numbers are not accepted packaged-runtime baselines. Keep the Electron-ABI/native-adapter check explicit in release performance runs.

## Search And Indexing

Search must be local-first. It should not call Google on each keypress.

Recommended approach:

- Start with indexed `LIKE` or FTS-backed search depending on scaffold choices.
- Cap result counts for interactive queries.
- Keep search index updates incremental after mutations and sync.
- Run large rebuilds in a background job.
- Treat search ranking as a service result, not renderer work.

## Sync Performance

- Initial sync may be expensive, but it must not block cached UI.
- Use incremental sync checkpoints after first sync.
- Apply backoff with jitter for rate limits and server failures.
- Batch local database writes inside transactions per resource.
- Publish progress and partial results rather than waiting for all accounts/calendars/lists.
- Avoid repeating full recurrence expansion when only one calendar changed.

## Diagnostics

Diagnostics should include sanitized performance fields:

- startup timings
- migration duration
- last sync duration by resource
- slow query samples without query parameters that contain personal content
- pending mutation counts
- MCP request counts and rate-limit status
- renderer performance smoke summary if available

Current scaffold note: IPC debug logging is opt-in via `HCB_IPC_DEBUG=1`. It records route names, durations, outcomes, and sanitized error codes only; request and response payloads are not logged.
