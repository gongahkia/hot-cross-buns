# Product and performance remediation

This checklist tracks the code-addressable findings from the October 2026 product audit. README.md is excluded from changes. Completion requires current runtime evidence, not only green unit tests.

## Trust and feature identity

- [x] Replace generic recovery success with explicit supported actions or errors.
- [x] Create consistent SQLite snapshots; export them; restore local notes without replaying old Google queues.
- [x] Verify automatic backup cadence and retention; reject unconfirmed restores. Failure paths report errors instead of success.
- [x] Honor Manual, Balanced (5 minutes), and Near real-time (30 seconds) sync modes, including automatic mutation sync.
- [x] Respect individual Tasks and Calendar sync switches.
- [x] Remove unreachable Advanced Settings scaffolding and reachable unsupported MCP controls. Reject unfinished operations at the IPC boundary.
- [x] Remove unsupported attachment-store and server-backlink controls; preserve implemented inline Drive and planner references.
- [x] Label device-only task stars and persist task stars and list sorts in SQLite settings.
- [x] Verify preference persistence across application restarts and cover note stars and workspace preferences in backups.
- [x] Explain Smart Schedule's linked Calendar events and separate Google Tasks due dates.
- [x] Replace immediate arbitrary task scheduling with a reviewed calendar/time/duration dialog.
- [x] Explain planning metadata stored in Google-visible task notes.
- [x] Label local-only notes at capture and reading points, and explain the planning workflow during onboarding.
- [x] Keep empty task lists visible.
- [x] Distinguish the API task day from Google's native Deadline/timed-task fields; document parity features and actual differentiators.
- [x] Replace the onboarding time claim with the actual Google Cloud prerequisite and planning benefit.
- [x] Reconcile product/specification documents with implemented capabilities (without editing README.md).

## Responsiveness and memory

- [x] Virtualize task roots, expanded children, and completed rows using measured heights; retain keyboard navigation.
- [x] Group tasks in one pass rather than scanning all tasks once per list.
- [x] Bound offscreen list columns and verify expanded/selected rows, focus, menus, drag/drop, and scrolling at runtime.
- [x] Paginate Tasks and Notes in SQL instead of materializing each whole table per page.
- [x] Bound renderer task/note data and full text by the active viewport or request; eliminate eager full-collection hydration.
- [x] Bound cached Calendar windows, including adjacent month navigation.
- [x] Verify cache concurrency and filter changes. Recurrence projection is now cached across pages with a three-range bound and invalidation on database changes.
- [x] Move SQLite, recurrence, indexing, backups, and sync processing to a worker; keep OS credentials and window controls in main.
- [x] Create the window before database readiness and start automatic sync after cached data renders.
- [x] Verify shutdown, worker errors, and responsiveness while a large background operation runs.
- [x] Avoid a second full Google pull when no writes are queued.
- [x] Batch sync upserts and use incremental Tasks reads with deletion tombstones and cross-page parent reconciliation. Advance watermarks only after a successful full pull, using the first response's server clock.
- [x] Update FTS documents by indexed identity and bound search snippets.
- [x] Split route bundles and defer the emoji dataset until needed.
- [x] Make embedded web-view resource use explicit and bound its optional lifecycle.
- [x] Cache derived projections and narrow subscriptions so unrelated status changes do not reshape entire collections.
- [x] Batch row measurements with one ResizeObserver; reuse bounded date formatters and prepared statements.
- [x] Use indexed recent-note pages, sort only starred subsets, and bound legacy previews/imports by the requested records.
- [x] Use consistent Calendar viewport timezones while preserving original event zones and floating all-day dates.
- [x] Use transitions for primary navigation and remove full-screen backdrop filters from editing/capture overlays.

## Measurement and verification

- [x] Repair the performance smoke test's onboarding path and wait for actual hydration and rendered content.
- [x] Record process PSS on Linux, mounted task rows, launch, hydration, search, navigation, and scroll-to-end timings.
- [x] Implement bounded real timing samples and session logs instead of placeholder acknowledgements.
- [x] Verify real diagnostics export and timing validation, including omission of note bodies from exported diagnostics.
- [x] Add p95 input/frame and main-process latency measurements, stable regression budgets, and constrained-memory runs.
- [x] Run final 1k/5k/10k fixtures against the final build, compare memory to the audited baseline, and inspect the rendered UI.
- [x] Run the final typechecks, unit/database/security tests, and Electron workflow smoke tests.
- [x] Audit every original finding against the final worktree, and verify README.md has no diff.

## Evidence by audit area

| Area | Current implementation and verification |
| --- | --- |
| Recovery and diagnostics | [CoreStore integration](../../src/main/services/coreStore.test.ts), [backup lifecycle](../../src/main/services/localBackups.test.ts), and [Electron workflows](../../tests/smoke/app.spec.ts) verify SQLite snapshots, cadence/retention, note-only recovery, confirmation rejection, preference inclusion, and exported diagnostics without note bodies. |
| Sync correctness and work | [Google sync tests](../../src/main/services/googleSync.test.ts) cover mode cadence, service switches, incremental Tasks, failed-page checkpoints, parent reconciliation, no-write pull behavior, and shutdown during a pull. These use mocked Google transport. |
| Feature identity | [Current capabilities](../product/current-capabilities.md) records ownership, actual Google parity, public API gaps, switching costs, and unavailable controls. Onboarding, scheduling review, note capture, metadata notices, and device-star labels expose those distinctions in the app. Unsupported privileged actions fail at the IPC boundary; [IPC validation](../../src/main/ipc/core.test.ts) covers that boundary. |
| Tasks and Notes bounds | [Paged-list tests](../../src/renderer/src/components/PagedVirtualList.test.tsx) cover measured geometry, a million-row position calculation, distant focus, query concurrency, disabled cache release, and empty-list revalidation. SQL integration checks scoped previews/full reads, stars across page boundaries, and an indexed Notes query plan. Electron checks 20 task columns, context menus, parent search, drag/drop, Home/End, expanded children, and 230 full-body notes. |
| Editing and preferences | [Notes editing tests](../../src/renderer/src/features/core/screens/notesPaging.test.tsx), [task editing profiles](../../src/renderer/src/features/core/screens/tasks/taskInspector.profile.test.tsx), and [inspector close tests](../../src/renderer/src/components/Inspector/InspectorContext.test.tsx) verify local typing, failure/draft retention, save races, one-time creation, close refusal, editor autofocus, and nested-modal Escape ownership. Electron checks immediate Escape and Tab wrapping; closing restores the initiating control. Electron restarts verify task/note stars, list sort, and pane preferences. |
| Calendar correctness and retention | [Range/cache tests](../../src/renderer/src/features/core/viewModelSource/calendarRangeCache.test.ts), [provider tests](../../src/renderer/src/features/core/viewModelSource/providerCache.test.tsx), [timezone tests](../../src/shared/zonedTime.test.ts), and SQLite/Electron checks cover stale replies, bounded windows, local-midnight fetches, DST, mixed event zones, and all-day conversion. [Manual scheduling tests](../../src/renderer/src/features/core/screens/tasks/TaskScheduleDialog.test.tsx) cover explicit review and cancellation. |
| Worker/native lifecycle | [Worker client tests](../../src/main/services/workspaceClient.test.ts) cover startup/exit failures and bounded close. Backup/sync tests wait for in-flight work on shutdown. Native planning/notification tests verify compact exact counts, queue bounds, and delivery deduplication. Performance runs exercise the real worker/IPC boundary during all fixture writes and populated-profile restart. |
| Embedded pages | Electron checks real guest webContents creation on Load and destruction on Pause. Restored pages begin paused. Optional loaded pages consume additional memory. |
| Rendering and measurements | The [performance harness](../../scripts/perf-smoke.ts) validates rendered content and page bounds, captures browser-side input/navigation timings and raw samples, samples process PSS/CDP heap, and enforces [regression ceilings](../../scripts/performanceBudgets.ts). Source test counts and reviewed fixture results are recorded below. |

## Reviewed final performance evidence

18 October 2026; Linux/WSL2, Xvfb, Intel i7-1355U, 12 logical CPUs, 4,917 MiB system RAM. Each fixture contains the stated number **in each of Tasks, Calendar events, and Notes**; note bodies exceed 4,000 characters. Runs were sequential against the final executable, with no concurrent build or test suite. Other applications were not controlled; system load is included in each report.

| Fixture | Maximum sampled Electron PSS | Maximum sampled renderer JS heap | Input-to-paint p95 | Scroll-frame p95 | Populated-profile restart to content |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 each | 460.8 MiB | 16.0 MiB | 28.3 ms | 24.2 ms | 1231 ms |
| 5,000 each | 497.1 MiB | 15.0 MiB | 28.0 ms | 29.6 ms | 1041 ms |
| 10,000 each | 441.4 MiB | 12.9 MiB | 28.8 ms | 18.4 ms | 1098 ms |
| 10,000 each · 128 MiB old-space | 455.7 MiB | 14.6 MiB | 28.7 ms | 18.7 ms | 1075 ms |

| Fixture | Initial hydration | Local FTS search | Main IPC p95 during writes | Notes navigation | Cached Tasks navigation |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 each | 137.8 ms | 11.3 ms | 0.8 ms | 62.3 ms | 38.5 ms |
| 5,000 each | 166.7 ms | 15.8 ms | 1.6 ms | 67.9 ms | 56.7 ms |
| 10,000 each | 194.1 ms | 15.6 ms | 1.0 ms | 68.9 ms | 58.3 ms |
| 10,000 each · 128 MiB old-space | 212.1 ms | 20.2 ms | 1.1 ms | 68.0 ms | 77.6 ms |

Every run met all 16 budget targets and ceilings. All task boards mounted 16 rows; lookup/page bounds, full records on demand, and Calendar item counts were asserted. The constrained run reported a 141 MiB total renderer JS heap limit for its 128 MiB old-space setting, and also completed populated-profile restart. No renderer long tasks were recorded during the 24-character input samples. Report maxima need not grow monotonically: garbage collection and Chromium/native allocators affect when retained memory is sampled.

The default renderer heap ceiling reported by Chromium was 2,089 MiB; actual sampled use was far smaller. Empty-workspace idle samples were 344–351 MiB total Electron PSS. These results demonstrate bounded retention for the tested distributions, not a claim that the theoretical heap ceiling is allocated or that every possible dense Calendar dataset fits a fixed byte budget.

Raw JSON, raw latency samples, resource breakdowns, and budget outcomes remain in ignored `artifacts/perf/1000-each.json`, `5000-each.json`, `10000-each.json`, and `10000-each-heap128.json`. The investigated failing input report is retained under `artifacts/perf/history/5k-input-before-flat-overlays.json`. Definitions and reproduction commands are in [build/test performance](build-and-test-performance.md).

## Final checks

- Both TypeScript checks and the production Electron/Vite build pass.
- Unit suite: 152 passed. Its 39 CoreStore cases skip under Node's incompatible SQLite ABI and all pass separately under Electron via `test:db`.
- SQLite suite: 39 passed, including indexed paging, recovery, preferences, recurrence, and native-count integration.
- Security suite: 66 passed; these overlap the unit suite and are not additional distinct tests.
- Electron workflows: six passed, including real backups/restoration/export, tree navigation, context menus/drag/drop, paging/full records, persisted preferences, Calendar zones, modal autofocus/Escape/Tab behavior, and real webContents release.
- The final workflow pass ran alongside the unit suite after the inspector focus race was fixed. Performance runs were then executed separately.
- Task board, paged Notes, and the flat note-editor overlay were inspected as actual Electron screenshots. Wrapped-row overlap also has a runtime assertion.
- `git diff --check` passes. `git diff --exit-code d44075e -- README.md` passes; README.md is unchanged from the start of remediation.

## Historical comparison

- The audited Tasks board mounted 5,000 task DOM rows and used approximately 1,769.6 MiB total Electron PSS.
- An intermediate worker build with 10,000 tasks and 10,000 events used 508.5 MiB PSS, with 3,340 ms hydration. Later runs also include full-body Notes and use calibrated browser timings, so timing deltas across those harness versions are not controlled before/after results.
- Batching ResizeObserver deliveries reduced a same-harness 1k scroll p95 from 36 ms to 19.6 ms. Browser-based navigation timing also exposed React's fallback delay; transitions reduced first Notes navigation in a smaller fixture from about 369 ms to 63 ms.
- A later 5k input run failed its 100 ms regression ceiling at 162.6 ms. It was retained for investigation. Removing full-screen backdrop filters brought a repeat to 28.2 ms p95, with all 24 samples between 24 and 31 ms and no observed renderer long tasks. This is Linux/Xvfb evidence, not an attribution of all platform stalls to blur.

## Limits of this verification

No implementation can make a desktop process independent of physical RAM. The contract is bounded work/data retention and measured response budgets. Electron still has a substantial fixed memory cost; it cannot honestly be described as a tiny-memory native app.

These are isolated synthetic Linux/WSL2/Xvfb fixtures, with no live Google account, representative macOS hardware, release packaging, or whole-machine RAM pressure test. A V8 old-space cap constrains JS rather than all native memory. Process PSS is sampled at workflow phases rather than continuously. The fixture has many total events but approximately 960 in the displayed day; it does not prove performance for 10,000 simultaneous events in one dense window. Calendar retention is bounded by requested windows, not a fixed byte ceiling.

The current task hierarchy restriction and Google API compatibility gaps are explicitly recorded in the product contract. They remain usability/platform costs rather than hidden promises of parity.
