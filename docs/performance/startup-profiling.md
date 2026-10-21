# Startup profiling

`pnpm profile:startup` builds once and records three fresh/cached launch pairs in isolated temporary profiles. `HCB_STARTUP_RUNS=1..20` changes the pair count. Each pair writes a local note and checks it survives the cached launch. `HCB_STARTUP_EXECUTABLE=/absolute/path/to/executable` profiles a packaged app.

Reports in ignored `artifacts/perf/startup-*.json` separate Playwright connection, first window, shell visibility, main-process startup milestones, navigation timing, host load, and free memory. The launcher and main/renderer clocks have different origins; compare durations within each clock. These are process launches, with normal OS filesystem caches.

## 2026-10-21 findings

The diagnostics overlay was imported by the shell even while closed. Loading it on demand reduces the renderer entry from 1,245.82 kB to 1,198.59 kB in the production build. Its keyboard shortcut still loads and displays the real diagnostics dialog, verified by `tests/smoke/startup.spec.ts`.

| Three-pair sample | Before | Deferred diagnostics |
| --- | ---: | ---: |
| Fresh shell-visible median | 1,663 ms | 1,592 ms |
| Cached shell-visible median | 2,053 ms | 1,479 ms |
| Fresh shell-visible range | 1,357–2,354 ms | 1,414–2,337 ms |
| Cached shell-visible range | 1,342–2,511 ms | 1,460–1,540 ms |

These samples came from a busy 8 GiB Intel Mac with host load around 14–22 and active swapping. They do not establish a controlled latency improvement. Entry-size reduction is deterministic; startup remains variable. The existing latency ceilings are unchanged. Use quiet-host scale runs and repeated packaged-app profiles before making a release performance claim.

The profiler uses an account-free temporary profile and does not read the normal HCB profile or authorize Google.
