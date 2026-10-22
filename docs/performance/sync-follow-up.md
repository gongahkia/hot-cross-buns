# Google sync follow-up verification

Recorded on 2026-10-21. Implementation and final local verification use `e57e5f8`.

## Changes

| Commit | Result |
| --- | --- |
| `8eb68ef` | Reconcile complete Calendar snapshots after token expiry or an explicit full resync. Retain pending edits; failed pages cannot prune absent records or advance checkpoints. |
| `6598481` | Mark Google tasks missing from complete full pulls as deleted. Incremental deltas retain unchanged tasks. |
| `cce200c` | Remove deleted Google Task lists, stale selections, and cache records. Preserve notes and independent Calendar events; retain unsent writes as explicit conflicts. |
| `a914d68` | Preserve queued event creates, edits, deletions, and moves when a Calendar disappears. Keep task planning from surviving scheduled blocks. |
| `3466f7f` | Wait for an active sync before resetting tokens and starting a distinct forced full pull. |
| `e57e5f8` | Retain cancelled recurring occurrences across pulls and restarts, scope exceptions to their Calendar, and reconcile restored/deleted series. Schema 9 preserves existing data and rebuilds Calendar checkpoints once to recover previously discarded cancellations. |
| `34e4fb5` | Break the date-helper import cycle through the shared screen module. All six renderer circular-dependency warnings are gone. |
| `dd0218f` | Extend the opt-in live suite to verify cleared Task fields and sibling ordering after full Google pulls. |

README.md is unchanged from `959969e`, the starting revision of this follow-up.

## Local verification

- Production build and both TypeScript checks pass.
- 162 unit tests pass.
- 88 SQLite and Google-sync integration tests pass under Electron's Node ABI.
- Six Electron desktop smoke tests pass against the final schema-9 build.
- This follow-up adds 31 local regression cases, including schema 6/8 upgrades and Notes recovery from schema 8 backups.
- The nine live Google checks were enumerated with Playwright `--list` using a temporary directory. Enumeration launches no app and makes no Google requests.

Local sync integration tests use real SQLite and mocked Google REST responses. Live Google execution remains pending: no signed-in disposable account/profile, dedicated resources, or mutation acknowledgement was supplied. See the [live test guide](../live-google-testing.md) for the required setup. The build retains the existing Tailwind module-format notice.

## Performance evidence

Hardware: macOS 15 / Darwin 24.6, Intel i5-8279U, eight logical CPUs, 8 GiB RAM, Node 24.19.0, Electron 33.4.11. Each fixture contains the stated count **in each of Tasks, Calendar events, and full-body Notes**. Fixtures use isolated local profiles without Google accounts.

Builds and test suites completed before measurements. Fixtures ran sequentially. The final preflight required at least 75% CPU idle over a one-second sampling interval and a one-minute load of at most six. The final 1k run started at 78.66% CPU idle and load 4.54. Other applications remained open; the host was not dedicated to benchmarking.

| Measurement | Final 1k (`e57e5f8`) | Quieter 5k repeat (`dd0218f`) | First 10k (`dd0218f`) |
| --- | ---: | ---: | ---: |
| Regression gate | Passed | Passed | Failed: initial launch |
| Initial shell visible | 1,706.98 ms | 1,812.91 ms | 2,560.72 ms |
| Cached-profile content visible | 1,387.97 ms | 1,381.95 ms | 1,548.32 ms |
| Task hydration | 194.90 ms | 230.50 ms | 323.90 ms |
| Pending outbox selection / read-only sync | 11.34 ms / 2,000 writes | 43.38 ms / 10,000 writes | 96.92 ms / 20,000 writes |
| Typing to paint p95 | 31.00 ms | 33.30 ms | 33.00 ms |
| Scroll frame p95 | 22.10 ms | 30.10 ms | 17.80 ms |
| Main IPC during writes p95 | 0.60 ms | 0.50 ms | 0.60 ms |
| Maximum sampled renderer JS heap | 15.5 MiB | 16.3 MiB | 12.6 MiB |
| One-minute load, start / end | 4.54 / 5.65 | 3.48 / 3.15 | 10.50 / 7.00 |

All completed fixtures passed their functional assertions and interaction regression ceilings. Initial launch has a 1,500 ms target and 2,000 ms ceiling; even passing runs still miss its target. The first 5k run also failed launch at 2,122.61 ms before its quieter repeat passed. The 10k queue measurement stays below its 100 ms ceiling but misses the 30 ms target; 10k hydration misses its 300 ms target while staying below its 1,000 ms ceiling. Thresholds were unchanged.

Final 5k/10k repetitions after the cancellation-cache migration remain pending. After the final 1k pass, a three-minute preflight could not obtain the required host conditions, so those larger runs were not launched. The preceding 5k/10k measurements use the earlier `dd0218f` build and cannot certify the final schema-9 build at those sizes. Startup variability remains unresolved; these measurements do not establish its cause.

Process PSS is unavailable from this harness on macOS. Renderer JS heap is only one part of Electron's memory use. These are synthetic local fixtures; Google network/authorization latency and dense simultaneous-event scenarios require separate checks.

Raw reports and host snapshots remain in ignored `artifacts/perf/history/`:

- `e57e5f8-1000-each.json` and `.md`, plus `e57e5f8-1000-host-before.txt`;
- `dd0218f-1000-each.json`;
- `dd0218f-5000-each-first.json` and `dd0218f-5000-each-repeat.json`;
- `dd0218f-10000-each.json`;
- `959969e-1000-each-overloaded.json` and `.md`, preserving the earlier high-load failure.

After building once and stopping other repository jobs, repeat each fixture sequentially with `HCB_PERF_COUNT=1000 pnpm exec tsx scripts/perf-smoke.ts`, substituting `5000` and `10000`. Keep every failed report alongside repeats, and use the environment fields to qualify comparisons.
