# Browser workspace measurements

Measured in Chromium 148.0.7778.96 on Linux, 12 logical CPUs and 5.16 GB reported physical memory. The final run used the built test-mode application with competing builds stopped. The full observations, sample distributions, navigation timings, and memory values are in [browser-mixed.json](browser-mixed.json).

| Dataset | 1,000 tasks + 1,000 notes + 1,000 events | 5,000 tasks + 5,000 notes + 5,000 events |
| --- | ---: | ---: |
| Total records | 3,000 | 15,000 |
| Durable snapshot | 3.36 MB | 14.30 MB |
| Reopen and bootstrap, median | 495 ms | 894 ms |
| Full-text search, 50 results, median | 11 ms | 38 ms |
| Full January calendar range, median | 45 ms | 157 ms |
| Calendar summaries returned | 351, one page | 1,735, four pages |
| Durable task/note/event edit, median | 29 ms | 53 ms |
| Durable edit, p95 observed | 45 ms | 65 ms |
| SQLite snapshot export, median | 3.4 ms | 9.1 ms |
| IndexedDB transaction completion, median | 11.5 ms | 29.2 ms |
| Worker WASM heap allocation | 17.63 MB | 68.75 MB |
| Renderer used JS heap after operations | 23.19 MB | 27.29 MB |
| Observed main-thread long tasks | 0 | 0 |
| Animation-frame gap, p95 | 16.8 ms | 16.8 ms |

Each size uses a separate browser context, real SQLite FTS triggers, and real IndexedDB transactions. The script measures three reopen samples, five search queries, five complete calendar-range reads using the renderer's 500-summary pagination, and fifteen edits split across tasks, notes, and events. Search and calendar timing occurs inside the browser; only summary counts and timings cross the debugging protocol, avoiding artificial long tasks from serializing thousands of records into the test runner. Edits include the durable acknowledgment and bridge overhead. Startup includes a warm HTTP-cache reload and bootstrap, not a first-ever network download. The calendar dataset covers January–March 2027; the explicit query measures January independently of the initial screen's current date.

Heap readings are Chromium renderer-isolate diagnostics without forced garbage collection. WASM reports allocated worker heap, not live SQLite bytes or complete process RSS. The long-task observer covers the renderer; absence of tasks over its 50 ms threshold does not mean the application performs no main-thread work. These small sample sets are observations, not statistical guarantees or budgets for slower devices. Concurrent builds produced substantially worse results during development; the final baseline was rerun after that contention stopped.

Every mutation still exports and commits a full database snapshot. The measured 14.3 MB workspace incurs roughly 38 ms of export plus durable persistence before other overhead; those costs grow with database size. A page-based persistence implementation could reduce write amplification but must preserve atomic metadata, undo/outbox state, rollback, statement invalidation, and revision checks. It should be justified by measurements and equivalent failure tests before replacing the correct snapshot approach. Online Google sync also holds the authoritative writer lock while requests and durability checkpoints complete; these local-only numbers do not measure that contention.

Run `corepack pnpm measure:storage` for a fresh build and measurement. `HCB_BENCHMARK_SKIP_BUILD=1` reuses `dist-benchmark` for a quiet repeat; use it only after verifying that directory contains the intended code. `HCB_BENCHMARK_COUNTS` selects per-domain record counts and `HCB_BENCHMARK_OUTPUT` chooses the report path. CI measures after the other validation jobs in each Linux runner, avoiding competing application builds in the same job.
