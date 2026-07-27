# Native Wrapper Scale Budgets v1

This gate covers a deterministic Google-wrapper cache: 10,000 tasks, 25,000 visible-range Calendar event instances, 2,000 undated-task note projections, 500 Calendar recurrence exceptions, and 500 queued mutations. Data is generated only; no credentials, network calls, or user data are used.

## Execution

`native-performance-report` runs on `macos-14` for scheduled and manually dispatched CI. It builds Release binaries, runs Qt Quick with `-platform offscreen`, captures `sw_vers`, CPU identity where available, architecture, tool versions, and the checked commit in the artifact. Offscreen frame numbers are regression signals, not a claim about physical-display latency.

Cold launch is the first child launch in the job. Warm launch is three subsequent child launches after the cold report; neither flushes macOS disk caches. First cached render starts after the benchmark process has initialized its system font selection and includes materializing the 10,000-task model plus its first rendered frame.

## Enforced Budgets

| Flow | Dataset | Hard CI limit |
|---|---|---:|
| Cold launch max | native shell | 8s |
| Warm launch median | native shell | 5s |
| Idle RSS | native shell | 1GiB |
| First cached task render | 10k tasks | 1.2s |
| Task scroll frame max | 10k tasks | 100ms |
| Bulk select median | 10k task IDs | 100ms |
| Local search median | 10k tasks | 105ms |
| Calendar navigation median / max | 25k event instances | 250ms / 500ms |
| Sync-apply delta | 10k tasks, 25k events, 500 queued mutations | 45s |

The limits are intentionally wider than the product targets in [performance strategy](performance-strategy.md): shared CI hardware and offscreen rendering are noisy. A breach fails the performance job and retains all JSON plus environment evidence for 14 days. Tighten only after comparing multiple successful scheduled runs; do not silently raise a limit.

## Scope And Guardrails

- Task reads are bounded at 10,000 rows; calendar range reads are bounded at 25,000 rows.
- Search uses its local worker service. Calendar view layouts are built before their main-thread model application.
- Mirror upserts skip unchanged remote rows, avoiding unnecessary FTS delete/reinsert work during repeated pulls.
- The sync benchmark seeds the scale cache, then measures an incremental mirror apply with queued rows present. It does not call Google.
