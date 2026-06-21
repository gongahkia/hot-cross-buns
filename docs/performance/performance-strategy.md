# Performance Strategy

Hot Cross Buns must feel immediate because it is a keyboard-first planning tool. Performance work is not a late cleanup pass; every layer should preserve responsiveness from the first scaffold.

## Product-Level Targets

Use these budgets as engineering targets until real measurements justify different values:

| Flow | Target |
|---|---:|
| Cold app shell visible on a typical developer Mac | under 1500ms |
| Warm app shell visible | under 700ms |
| Cached Today/Tasks/Calendar render after database open | under 300ms |
| Command palette opens after shortcut | under 100ms |
| Quick capture opens after global hotkey | under 150ms |
| Search result update after typing | under 100ms for cached local data |
| Common task/event mutation optimistic feedback | under 100ms |
| Renderer frame budget during scrolling/typing | 16ms target, 32ms maximum sustained |
| Main-process synchronous blocking during user interaction | under 20ms per operation |

These are user-perceived goals, not promises. If a budget is missed, the implementation must record the reason and a follow-up path.

## Architecture Rules

- Keep renderer work small and predictable. Large data shaping belongs in main/worker services before crossing IPC.
- Keep main process responsive. Startup orchestration, window lifecycle, menus, tray, shortcuts, and IPC registration must not wait on full sync.
- Move database-heavy, sync-heavy, CPU-heavy, and indexing work to service queues, worker threads, or Electron utility processes when it can block the app.
- Render from local SQLite cache first, then refresh from Google.
- Send view models across IPC, not raw unbounded database rows or raw Google payloads.
- Do not use performance shortcuts that weaken the security model.

## Startup Strategy

Startup should be staged:

1. Create the main window and load the renderer.
2. Initialize minimal app services needed for the shell.
3. Open SQLite and run migrations.
4. Render cached shell and primary view.
5. Start background sync only after the app is interactive.
6. Defer optional services such as MCP, updater checks, deep diagnostics, and expensive search indexing.

Do not block first paint on Google OAuth refresh, remote sync, full diagnostics, update checks, MCP startup, or large database compaction.

## Measurement First

Electron's own performance guidance emphasizes profiling running code and optimizing the actual bottleneck. Hot Cross Buns should keep that discipline:

- Add timing spans around startup phases.
- Measure IPC latency for common calls.
- Measure database query duration for primary views.
- Measure renderer commit duration for heavy screens.
- Measure search latency as account size grows.
- Track memory after launch, after first sync, and after large list/calendar navigation.

## Performance Fixtures

The test suite should eventually include deterministic large local datasets:

- Small: 50 tasks, 20 events, 10 notes
- Medium: 1000 tasks, 1000 events, 200 notes
- Large: 10000 tasks, 25000 event instances, 2000 notes

Large fixtures must use generated local data only. They must not hit Google or a user's real app data.

## Regression Gates

Before Mac v1 release, add a performance smoke suite that records:

- cold launch timing
- warm launch timing
- command palette open latency
- quick capture open latency
- local search latency against medium fixture
- Tasks list scroll stability against large fixture
- Calendar month navigation latency against large fixture
- SQLite query plan checks for core queries

The suite should report numbers even before it fails builds. Hard failure thresholds should be introduced once baseline numbers are stable.

## Reference Docs

Useful upstream docs:

- Electron performance checklist: https://www.electronjs.org/docs/latest/tutorial/performance
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- React Profiler: https://react.dev/reference/react/Profiler
- Vite performance guide: https://main.vitejs.dev/guide/performance.html
- TanStack Query render optimizations: https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations
- TanStack Virtual introduction: https://tanstack.com/virtual/v3/docs/introduction
- SQLite query planner: https://www.sqlite.org/queryplanner.html

