# Generated-content memory budget

## Status

These are proposed release allocations for the baseline graphics tier. They are limits for measured resident memory, not estimates from asset file sizes. Missing or incomparable telemetry fails the memory gate.

## Pools

| Pool | Baseline cap | Owner | Release condition |
| --- | ---: | --- | --- |
| active chunk scene nodes, meshes, collision, materials | 384 MiB | `WorldStreamer` | key exits active window after handoff/eviction |
| bounded CPU descriptor/payload cache | 192 MiB | cache | LRU eviction before admitting a new entry |
| in-flight worker requests and responses | 48 MiB | scheduler queue | response consumed, cancelled, or failed |
| terrain/region shared resources | 192 MiB | resource manager | process/session shutdown or deterministic shared-resource eviction |
| particles, weather, photo staging buffers | 128 MiB | presentation systems | feature deactivation or fixed ring replacement |
| run records, telemetry, journal, save staging | 32 MiB | run-state services | fixed-capacity ring/compaction or completed write |
| generation-related managed overhead | 128 MiB | generation systems | release with owning pool |
| **total generation-related resident memory** | **1,104 MiB** | expedition runtime | any pool breach triggers policy response |

The system cap excludes the Godot engine, operating system, unrelated UI, and driver-resident allocations that the process cannot attribute reliably. Process RSS and GPU memory remain recorded as corroborating metrics.

## Admission and eviction

1. Every generated allocation belongs to exactly one pool, chunk key/LOD, and owner.
2. Before creating a chunk payload, mesh, collision shape, or photo staging buffer, reserve its measured/declared upper bound. Refuse or defer work if the relevant cap would be exceeded.
3. Cache entries are evicted by explicit LRU order. Active chunks may not be evicted until visual/collision handoff permits release.
4. Eviction clears registry ownership, scene references, packed arrays, mesh/collision references, and telemetry references. `queue_free` alone is not evidence of reclamation.
5. Worker responses reserve queue capacity before generation begins. A cancelled/stale response releases its reservation without creating a scene node.
6. Per-chunk accounting includes descriptor, mesh, collision, feature geometry, resource/hazard payloads, and retained material/texture references; shared resources are counted once in their shared pool.
7. Any cap breach emits a structured event, stops low-priority admissions, and selects a documented degradation: lower LOD, reduce preload, evict cache, or reject optional presentation. It must not silently grow an unbounded collection.

## Measurement protocol

- Report pool bytes/counts, active/cached/in-flight keys, process RSS, engine static memory, and GPU memory if the platform provides it.
- Sample at cold start, after warm-up, stationary peak, a 15-minute one-direction traversal, rapid reversal, dense region transition, photo capture, and after returning to the starting region.
- A soak passes only when all pool caps hold, memory returns within 10% of the stationary post-warm-up baseline after the return path, and no owned chunk references remain for released keys.
- Compare the same Godot build, renderer, quality tier, seed fixture, active radius, cache cap, and path. Changing any of them starts a new baseline.

## Dependencies

- Chunk lifecycle, worker payload, LRU cache, graphics-tier, photo-mode, telemetry, and long-distance soak-test contracts.
- Godot profiler/export metrics where available; absence of a GPU metric does not waive CPU-pool accounting.

## Performance impact

Accounting adds fixed metadata per allocation and bounded telemetry events. It avoids unbounded memory growth but may defer detail or reduce preload under pressure; any degradation must preserve collision and traversal safety.

## Out of scope

- A claim that current builds meet these caps.
- Exact GPU-driver, OS cache, allocator-fragmentation, or engine-internal memory totals.
- Disk-space budgets, download sizes, or save-file quotas.
- Retaining an unlimited edit history, photo cache, or chunk archive in memory.
