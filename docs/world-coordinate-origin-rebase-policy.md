# World-coordinate precision and origin-rebase policy

## Coordinate spaces

The expedition uses three distinct spaces. They must not be substituted for one another.

| Space | Representation | Owner | Use |
| --- | --- | --- | --- |
| World | `(chunk_x: int64, chunk_z: int64, local_x: real, local_z: real)` | generation/save contract | deterministic sampling, run records, sharing |
| Stream | `Vector2i(chunk_x, chunk_z)` | streamer | chunk identity, cache keys, scheduling |
| Engine-local | `Vector3` relative to `origin_chunk` | Godot scene/physics/render | node transforms, collision, camera, particles |

`CHUNK_SIZE` is a versioned world-unit constant. A world position is canonical only when `local_x` and `local_z` are normalized to `[0, CHUNK_SIZE)`; crossing either bound increments/decrements the corresponding signed 64-bit chunk index. Generation derives coordinates from the canonical world value, never from an engine-local `Vector3` alone.

## Origin rebase

`origin_chunk` is the world chunk represented by engine-local `(0, 0)` on the horizontal plane. The engine-local position is:

```text
local_xz = (world_chunk - origin_chunk) * CHUNK_SIZE + world_local
```

Rebase when the player enters a chunk whose horizontal distance from `origin_chunk` is at least 32 chunks. Set `origin_chunk` to the player’s current chunk and translate every active engine-local world node by the same horizontal delta before the next physics step. Do not rebase individual chunks, the player, or camera independently.

The rebase operation must:

1. Preserve canonical player/world coordinates exactly.
2. Translate active terrain, collision, dynamic props, pickups, anchors, camera-attached effects, and queued placement payloads consistently.
3. Keep chunk IDs, cache keys, generation seeds, run records, and discovery keys in world/stream space; they never change during a rebase.
4. Suspend or reject mixed-origin worker results. A result carries a world chunk ID and is converted to engine-local coordinates only when attached on the main thread.
5. Occur between simulation steps, not during collision solving, rendering submission, or scene-tree iteration.

## Precision rules

- Assume a standard Godot build with 32-bit `real_t` unless the shipped binary is explicitly verified as double precision. The policy must remain correct in the 32-bit case.
- Use signed 64-bit integers for world chunk indices, seeds, version fields, and serialized fixed-point distances.
- Keep active engine-local horizontal positions within roughly 32 chunks of the origin; active-radius expansion must reduce the rebase threshold or introduce nested local frames.
- Convert global concepts such as time, seed, region, weather, and landmark identity from explicit canonical fields; never infer them from a translated scene-node transform.
- Store positions in saves as chunk indices plus normalized fixed-point local offsets, not binary float text.

## Verification

Headless fixtures must compare the same world descriptor before and after rebases in positive and negative directions, including a region boundary and an active chunk seam. They also assert that no active physics/render node remains at the old origin after a rebase.

## Dependencies

- Deterministic seed/version policy and fixed `CHUNK_SIZE` schema ownership.
- World streamer lifecycle, worker payload serialization, collision handoff, and run-record schema.
- A main-thread scene mutation boundary for active chunks.

## Performance impact

Rebases are infrequent, bounded by the 32-chunk threshold, and translate only active scene nodes. Coordinate conversion occurs when attaching/changing active nodes, not for every generator sample. Expanding the active radius raises per-rebase transform work and must be profiled.

## Out of scope

- Vertical floating-origin rebasing, spherical planets, or a planetary coordinate reference system.
- Double-precision Godot builds as a required release dependency.
- Changing terrain generation resolution or chunk size without a major generator schema version.
