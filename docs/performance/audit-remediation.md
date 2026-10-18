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
- [ ] Verify preference persistence across application restarts and cover note stars and workspace preferences in backups.
- [x] Explain Smart Schedule's linked Calendar events and separate Google Tasks due dates.
- [x] Replace immediate arbitrary task scheduling with a reviewed calendar/time/duration dialog.
- [x] Explain planning metadata stored in Google-visible task notes.
- [x] Label local-only notes at capture and reading points, and explain the planning workflow during onboarding.
- [x] Keep empty task lists visible.
- [x] Replace the onboarding time claim with the actual Google Cloud prerequisite and planning benefit.
- [ ] Reconcile product/specification documents with implemented capabilities (without editing README.md).

## Responsiveness and memory

- [x] Virtualize task roots, expanded children, and completed rows using measured heights; retain keyboard navigation.
- [x] Group tasks in one pass rather than scanning all tasks once per list.
- [ ] Bound offscreen list columns and verify expanded/selected rows, focus, menus, drag/drop, and scrolling at runtime.
- [x] Paginate Tasks and Notes in SQL instead of materializing each whole table per page.
- [ ] Bound renderer task/note data and full text by the active viewport or request; eliminate eager full-collection hydration.
- [x] Bound cached Calendar windows, including adjacent month navigation.
- [ ] Verify cache concurrency and filter changes. Recurrence projection is now cached across pages with a three-range bound and invalidation on database changes.
- [x] Move SQLite, recurrence, indexing, backups, and sync processing to a worker; keep OS credentials and window controls in main.
- [x] Create the window before database readiness and start automatic sync after cached data renders.
- [ ] Verify shutdown, worker errors, and responsiveness while a large background operation runs.
- [x] Avoid a second full Google pull when no writes are queued.
- [x] Batch sync upserts and use incremental Tasks reads with deletion tombstones and cross-page parent reconciliation. Advance watermarks only after a successful full pull, using the first response's server clock.
- [x] Update FTS documents by indexed identity and bound search snippets.
- [x] Split route bundles and defer the emoji dataset until needed.
- [ ] Make embedded web-view resource use explicit and bound its optional lifecycle.
- [ ] Cache derived projections and narrow subscriptions so unrelated status changes do not reshape entire collections.

## Measurement and verification

- [x] Repair the performance smoke test's onboarding path and wait for actual hydration and rendered content.
- [x] Record process PSS on Linux, mounted task rows, launch, hydration, search, navigation, and scroll-to-end timings.
- [x] Implement bounded real timing samples and session logs instead of placeholder acknowledgements.
- [x] Verify real diagnostics export and timing validation, including omission of note bodies from exported diagnostics.
- [ ] Add p95 input/frame and main-process latency measurements, stable regression budgets, and constrained-memory runs.
- [ ] Run final 1k/5k/10k fixtures against the final build, compare memory to the audited baseline, and inspect the rendered UI.
- [ ] Run the final typechecks, unit/database/security tests, and Electron workflow smoke tests.
- [ ] Audit every original finding against the final worktree, and verify README.md has no diff.

## Intermediate evidence

Linux/Xvfb synthetic fixtures, not a live Google account or a representative macOS laptop:

- Audited Tasks board: 5,000 task DOM rows; approximately 1,769.6 MiB total Electron PSS.
- First virtualized run: 5,000 tasks plus 5,000 events; 15 task rows mounted; 474.5 MiB total PSS; hydration 1,761 ms. This fixture has more events than the baseline, so it is not a controlled before/after comparison.
- Worker smoke: shell launch and local task/event fixture pass; 1,000 tasks plus 1,000 events use 454.2 MiB PSS with 15 mounted rows. Large-data loading remains incomplete work.
- Intermediate worker 10k run: 10,000 tasks plus 10,000 events complete, 15 mounted task rows, 508.5 MiB total PSS, 3,340 ms hydration, 118 ms scroll-to-end, and 17 ms search. Subsequent sync/cache changes still need a final benchmark.
- Electron integration verifies actual SQLite backup and local-note restore through the worker and IPC boundary, including rejection of an unconfirmed restore.
- Electron tree/keyboard integration verifies collapse, virtual row bounds, Home/End focus, and wrapped-row layout without overlaps. Manual scheduling has tests for cancellation, explicit placement, and moving an existing block.
- A 128 MiB renderer heap run with 1,000 tasks/events completes at 383.6 MiB total PSS. Main health IPC p95 during writes is 4 ms; input-to-paint p95 is 104 ms. These are intermediate numbers under a synthetic workload; startup and hydration targets are not yet met consistently.
- Current verification pass: both typechecks/build, 118 unit tests, 29 database tests, security suite, and all three Electron workflow tests pass. Security overlaps the unit suite; these are not independent test totals. Remaining code changes require another final verification pass.

No implementation can make a desktop process independent of physical RAM. The intended engineering contract is bounded work and memory, with measured response budgets on constrained hardware. Real Google/macOS validation remains a separate environment requirement.
