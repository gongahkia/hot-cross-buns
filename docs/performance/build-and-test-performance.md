# Build And Test Performance

The rebuild exists partly to improve development velocity. Build and test speed are product infrastructure, not developer comfort only.

## Development Loop Goals

Targets:

- Dev server ready quickly enough for iterative UI work.
- Unit tests run in seconds for focused scopes.
- Electron smoke tests stay small and deterministic.
- Performance tests report stable local numbers without needing network access.
- Native packaging is separated from everyday typecheck/test loops.

## Vite Guidance

Follow Vite's performance guidance as the project grows:

- Keep plugin count low.
- Avoid slow work in startup hooks.
- Dynamically import large dependencies used only in rare flows.
- Use explicit import extensions in hot paths if resolution becomes expensive.
- Avoid transforming SVGs into React components by default; use URLs or strings for non-interactive assets.
- Use Vite profiling tools when dev server startup or reloads become slow.

## Test Suite Shape

Keep test layers separate:

- `test:unit`: domain and renderer unit tests
- `test:db`: SQLite migration/repository tests
- `test:security`: main/preload validation and security tests (also covered by the unit suite)
- `test:smoke`: Playwright Electron smoke tests
- `test:perf`: local performance smoke tests

Vitest uses at most two workers to keep concurrent renderer fixtures and module graphs within a predictable memory bound. Database tests run under Electron’s Node ABI in an isolated temporary directory.

The default `test` command runs the unit suite. Expensive performance and packaging checks may be opt-in until release gates require them.

## Performance Smoke Tests

The current suite generates isolated SQLite fixtures with 1,000, 5,000, or 10,000 tasks, events, and full-body local notes. It verifies actual content, task/page bounds, search, complete API pagination, distant scrolling, and Calendar range counts. It does not authorize Google or use a real profile.

```sh
pnpm test:smoke:1k
pnpm test:smoke:5k
pnpm test:smoke:10k
HCB_PERF_COUNT=10000 HCB_PERF_HEAP_MB=128 pnpm test:perf
```

On headless Linux, prefix those commands with `xvfb-run -a`. Run fixtures sequentially and keep builds/tests out of the measurement interval. Reports include CPU/OS/memory metadata and system load; this does not remove interference from other applications.

Navigation and initial hydration use browser click-to-content-and-two-animation-frame timing. Automation validation time is recorded separately because assertion retry intervals can inflate latency. Input p95 also measures within Chromium, rather than timing automation round trips. Scroll p95 samples 119 frame intervals; input p95 samples 24 characters. Main health IPC runs repeatedly during all fixture writes. Each fixture also closes and relaunches its populated profile, then waits for real task content and hydration before recording restart latency.

After seeding, a read-only refresh against the account-free fixture measures durable outbox selection with all Task and Calendar writes still pending. Its 100 ms regression ceiling catches repeated scans of earlier mutations; queue barriers should be calculated once per account rather than once per candidate mutation.

The [budget policy](../../scripts/performanceBudgets.ts) preserves product targets and separate regression ceilings. A ceiling failure exits nonzero after saving the report. Target misses remain explicit even when the regression gate passes. These are engineering guards for this fixture and environment, not universal latency guarantees.

Reports under ignored `artifacts/perf/` include:

- `latest.json` and `latest.md`;
- `<count>-each.json` for each fixture size;
- `<count>-each-heap128.json` for the constrained run;
- `latest-failure.txt` if a run fails.

JSON records process PSS on Linux, process breakdowns, CDP renderer heap usage, the actual JS heap limit, mounted task rows, raw frame/input/IPC samples, typing long tasks, and budget outcomes. PSS is sampled at defined workflow phases, not continuously; the maximum reported sample is not a guarantee about every transient allocation. A V8 old-space limit constrains JavaScript memory and does not cap all Chromium/native memory or simulate whole-machine RAM pressure.

Generated reports stay local. The checked-in [remediation evidence](audit-remediation.md) records the reviewed baseline and its limitations.

## Bundle And Dependency Hygiene

- Keep renderer dependencies separate from main-only dependencies.
- Avoid shipping test-only and build-only libraries in runtime bundles.
- Lazy-load settings, diagnostics, large editors, and rarely used panels.
- Keep native modules behind adapters.
- Review bundle size before release packaging.

## CI Strategy

When CI exists:

- Run typecheck and unit tests on every PR.
- Run SQLite and IPC contracts on every PR.
- Run Playwright smoke on PRs that touch app shell, preload, main, or renderer routes.
- Run performance smoke nightly or before release until thresholds stabilize.
- Run packaging on release branches or tags.

