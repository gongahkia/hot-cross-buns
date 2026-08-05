# Bounded LRU chunk cache

`WorldChunkCache` retains bounded immutable chunk descriptors. `WorldStreamer` caches completed worker descriptors and reuses them on reattachment; scene nodes, meshes, collision, and props are never cached.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_chunk_cache_test.gd
```

## Dependencies

- Main-thread streamer descriptor ownership and worker responses.

## Performance impact

Bounded dictionary/recency storage; cached descriptors avoid repeat descriptor generation only.

## Out of scope

- Mesh cache, disk persistence, payload-byte budgeting, and active-node eviction.
