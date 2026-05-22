# Main, IPC, And Data Performance

Hot Cross Buns 2 uses Electron main/preload/renderer boundaries. The main process is responsible for app lifecycle and native integration, so it must avoid becoming a shared bottleneck.

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
