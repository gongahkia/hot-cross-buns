# Chunk ownership, lifecycle, and cancellation contract

## Ownership

One `WorldStreamer` owns all active expedition chunks for one immutable world identity. It owns the chunk registry, desired-set calculation, priority ordering, active scene roots, and cache admission/eviction decisions. No child chunk may attach itself or mutate the registry.

| Asset | Owner | Allowed thread | Lifetime |
| --- | --- | --- | --- |
| `ChunkKey(world_id, chunk_x, chunk_z, lod)` | scheduler/registry | any | immutable key |
| `ChunkRequest(key, generation_epoch, priority)` | scheduler | main thread | until cancelled or terminal |
| plain generation payload | worker producer, registry consumer | worker → main handoff | until attached, cached, or discarded |
| Godot `Node`, mesh, collision shape, material instance | streamer | main thread only | active/evicting chunk |
| cached descriptor/payload | bounded cache | main thread | until LRU eviction or world disposal |

The registry is the single source of truth. Scene-tree presence is not proof that a key remains desired, and a worker response is not proof that it remains current.

## State machine

```text
absent → requested → queued → generating → ready_to_attach → active → evicting → released
                  ↘ cancelled ────────────────────────────────────────────────┘
generating/ready_to_attach/active → stale → released
```

- `requested`: desired-set update created a record with the current world identity and generation epoch.
- `queued`: scheduler selected the request but worker work has not started.
- `generating`: an immutable request is executing; it owns no Godot scene object.
- `ready_to_attach`: a complete validated payload awaits main-thread attachment.
- `active`: the streamer's root node is present and its collision/render ownership matches the registry record.
- `evicting`: the key is no longer desired; attachment stops and the root is queued for main-thread release.
- `cancelled`: queued work was withdrawn, or in-flight work was marked unwanted. It may still produce a response, which is discarded.
- `stale`: the response or active record no longer matches current world identity, generation epoch, requested LOD, or key. It is discarded without side effects.
- `released`: no owned node, worker task, or cache lease remains. Only this state permits the key to be recreated.

## Cancellation and staleness rules

1. Recompute the desired set before starting new work. Requests outside it are cancelled before lower-priority work starts.
2. Cancellation is idempotent. Repeated calls cannot detach a replacement record for the same key.
3. In-flight computation is cooperative: workers check cancellation at bounded stages and return no partial attachable payload.
4. Every response is accepted only if its `world_id`, `generation_epoch`, key, LOD, and request token equal the current registry record. Otherwise mark it stale and release it.
5. World identity change, streamer shutdown, or origin/session teardown cancels every nonterminal request before releasing scene roots.
6. `queue_free` is requested only by the main-thread owner. The registry removes ownership before the next desired-set update can recreate the key.
7. Active chunks that leave the desired set first lose scheduling/attachment eligibility, then release collision and visuals together unless an explicit collision-handoff state owns both.

## Failure handling

A generation exception, invalid payload, or attach failure transitions the request to a terminal failed record with an error code and telemetry. It must not retry indefinitely, create a visible half-chunk, or block higher-priority chunks. Retry policy is explicit and bounded by key/epoch.

## Verification

Headless tests cover: duplicate cancellation; result arrival after cancellation; result arrival after a replacement request; world change during generation; unload before attachment; attach failure; and registry/node counts after release. Tests assert that stale payloads do not create `Node` instances or modify cache contents.

## Dependencies

- World identity, coordinate/origin policy, worker-payload contract, priority scheduler, LRU cache, and collision handoff contract.
- Godot main-thread scene ownership and a bounded telemetry sink.

## Performance impact

The contract adds constant-size request metadata and token comparisons. It avoids constructing Godot nodes for cancelled/stale work; cooperative cancellation frequency and payload size must be profiled because they determine wasted worker CPU and transfer pressure.

## Out of scope

- Specific worker count, job-system implementation, cache capacity, or LOD heuristic.
- Network synchronization, disk-backed chunk persistence, or cross-session sharing of in-flight requests.
- Immediate interruption of a non-cooperative platform thread.
