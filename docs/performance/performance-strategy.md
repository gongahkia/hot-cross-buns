# Performance Strategy

## Budgets

| Path | Budget |
| --- | ---: |
| Local search wrapper-scale median | 105 ms |
| Visible timeline delegate work | 16 ms target; 32 ms sustained maximum |
| Release sync-apply benchmark | 45 s maximum |

The 105 ms local-search limit is deliberate headroom for a 10,000-task / 25,000-instance deterministic fixture; ordinary searches should be materially faster. See [native wrapper budgets](native-wrapper-scale-budgets-v1.md).

## Rules

- Keep the Qt GUI thread to input, model replacement, and visible delegates.
- Keep SQLite/search/sync/recurrence work in C++ services or their queues.
- Use indexed, prepared, bounded queries; apply filters before candidate limits and derive `hasMore` from post-filter results.
- Window or virtualize calendar views. Never instantiate an account-wide event set in QML.
- Batch independent Google writes only when API semantics preserve ordering and failure reporting.
- Give each Google request explicit timeout and cancellation; shutdown waits for or cancels workers safely.
- Measure a running release build before changing a limit.

## Required checks

```sh
cmake --build --preset macos-debug --target hcb_native --parallel 3
ctest --preset macos-debug --output-on-failure
.github/scripts/check-native-wrapper-performance.sh <artifact-directory>
```

Physical-display profiling remains required for dense Day and Week timelines; offscreen QML coverage is a regression signal, not proof of interaction smoothness.
