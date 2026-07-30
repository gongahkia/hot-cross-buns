# Threaded chunk scheduler

`WorldChunkScheduler` executes data-only chunk-descriptor requests on one Godot worker thread. `WorldStreamer` attaches only completed results on the main thread; terrain nodes, meshes, collision, and feature nodes remain main-thread-owned.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_chunk_scheduler_test.gd
```

The fixture checks negative coordinates, FIFO worker completion, tokens, and descriptors.

## Dependencies

- `WorldGenerator`, worker-payload contract, and main-thread streamer ownership.

## Performance impact

One bounded descriptor worker; startup waits for collision-ready initial chunks. Mesh/collision construction remains main-thread work.

## Out of scope

- Parallel mesh construction, cancellation/staleness policy, priority scheduling, and LRU caching.
