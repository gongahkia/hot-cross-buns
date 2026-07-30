# Streaming-hitch telemetry

`WorldStreamingTelemetry` records every streaming refresh aggregate and retains a fixed-capacity ring of refreshes at or above 22 ms. Each event includes refresh duration plus active, pending, cached, and far-chunk counts. `WorldStreamer` exposes the aggregate and emits `streaming_hitch` for each retained event.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_streaming_telemetry_test.gd
```

## Dependencies

- Godot monotonic ticks and streamer lifecycle counts.

## Performance impact

One monotonic clock read pair and bounded metadata allocation run per streaming refresh. Only hitch events enter the 64-entry ring.

## Out of scope

- Full-frame/GPU timing, profiler export, automatic mitigation, and a performance-compliance claim.
