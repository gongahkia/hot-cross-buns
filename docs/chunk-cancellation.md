# Worker cancellation and stale-result rejection

Queued chunk tokens can be cancelled before execution. In-flight work completes cooperatively as a cancelled response. The streamer attaches only a successful result whose token still matches the pending chunk record; unloaded/replaced results are ignored.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_chunk_scheduler_test.gd
```

## Dependencies

- Threaded scheduler, streamer pending-token registry, and main-thread node attachment.

## Performance impact

Cancellation removes queued work and prevents stale node construction; in-flight descriptor work is bounded.

## Out of scope

- Interrupting a running platform thread, retry policy, and cache eviction.
