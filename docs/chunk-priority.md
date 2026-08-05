# Chunk priority by camera and traversal velocity

`WorldStreamer` assigns queued chunks a deterministic priority: squared chunk distance, then forward-camera and horizontal traversal-velocity bias. `WorldChunkScheduler` keeps stable token order for equal priorities.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_chunk_scheduler_test.gd
```

## Dependencies

- Player camera/velocity, canonical chunk coordinates, and threaded scheduler.

## Performance impact

Priority is constant-time per requested chunk; queue sorting is bounded by active-radius demand.

## Out of scope

- Cancellation, starvation prevention, LOD, and cache policy.
