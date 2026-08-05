# World-generation performance budget

## Status

The values below are proposed release gates, not measured results. A gate becomes enforceable only after the benchmark harness records its hardware, Godot version, renderer, seed fixture, and raw samples. A missing measurement is a failed gate, not a pass.

## Frame budget

The default expedition target is 60 FPS (`16.67 ms` per frame) on the baseline tier defined by the graphics support matrix.

| Budget owner | Median | p95 | p99 | Hard rule |
| --- | ---: | ---: | ---: | --- |
| main-thread total frame | ≤ 14.0 ms | ≤ 16.67 ms | ≤ 22.0 ms | no sustained budget breach for 3 consecutive seconds |
| desired-set / priority scheduling | ≤ 0.15 ms | ≤ 0.40 ms | ≤ 0.80 ms | no allocation proportional to historical traversal distance |
| main-thread generation sampling | ≤ 0.50 ms | ≤ 1.50 ms | ≤ 3.00 ms | worker-owned work must not move here without budget review |
| payload validation and attach | ≤ 0.40 ms | ≤ 1.20 ms | ≤ 2.50 ms | attachment is amortized; one chunk cannot block a frame above 22 ms |
| collision handoff | ≤ 0.25 ms | ≤ 0.75 ms | ≤ 1.50 ms | visual/collision handoff remains atomic by contract |
| origin rebase | n/a | n/a | ≤ 4.00 ms | one rebase may not create a long-distance hitch |

## Streaming budget

| Metric | Proposed gate |
| --- | --- |
| visible missing chunk at current traversal direction | none after the declared preload lead time |
| stale/cancelled attach count | zero |
| worker queue latency, p95 | ≤ 250 ms |
| worker queue latency, p99 | ≤ 500 ms |
| active-window chunk attach rate | bounded by a configurable per-frame maximum |
| 15-minute traversal hitch | no frame > 50 ms; p99 frame ≤ 22 ms |
| memory-induced eviction/reload oscillation | zero for a stationary player and bounded during one-direction traversal |

## Benchmark protocol

1. Record CPU, GPU, RAM, OS, Godot version, export/debug mode, renderer, resolution, graphics tier, build commit, world identity, and command line.
2. Run headless deterministic generation fixtures for micro-costs, then an instrumented rendered traversal for frame/streaming costs. Do not compare headless and rendered timings as if they were the same metric.
3. Use fixed paths that cover positive/negative coordinates, region changes, dense urban content, water, high-relief terrain, chunk seams, cancellation, and at least one origin rebase.
4. Discard a documented warm-up interval; retain raw samples and report count, median, p95, p99, maximum, and dropped/failed samples.
5. Compare only like-for-like runs. A hardware, renderer, world-schema, active-radius, LOD, or instrumentation change starts a new baseline.
6. A regression exceeds budget when a gate fails or a like-for-like p95 rises by more than 10%; either requires diagnosis and an explicit accepted exception.

## Required telemetry

`WorldStreamer` telemetry must identify frame time, scheduler time, generation time, queue latency, payload bytes, attach time, collision handoff, active/cached chunk counts, cancelled/stale/failed request counts, and rebases. Metrics need world identity and chunk/LOD context but must not include player-identifying data.

## Dependencies

- Graphics tier matrix, chunk lifecycle, worker payload, cache/memory policy, origin-rebase policy, telemetry, and long-distance soak test.
- A repeatable benchmark machine or CI class for trend comparison.

## Performance impact

Instrumentation itself consumes CPU/memory. It is sampled or buffered with fixed capacity, and the benchmark records whether it was enabled. Production telemetry keeps aggregates and bounded recent events rather than an unbounded per-frame log.

## Out of scope

- Claiming current performance compliance.
- GPU shader, audio, UI, loading-screen, or platform-launch budgets outside generation/streaming ownership.
- A guarantee of identical frame timings across machines, drivers, or engine versions.
