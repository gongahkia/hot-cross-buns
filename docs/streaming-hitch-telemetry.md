# Streaming-hitch telemetry

`WorldStreamingTelemetry` records every streaming refresh aggregate and retains a fixed-capacity ring of refreshes at or above 22 ms. Each event includes refresh duration plus active, pending, cached, and far-chunk counts. `WorldStreamer` exposes the aggregate and emits `streaming_hitch` for each retained event.

Megastructure work adds four refresh phases: `macro_silhouette_ms`, `sector_shell_ms`, `structure_collision_ms`, and `traversal_detail_ms`. F3 shows their current and latest-hitch values. `StreamingProfileRecorder` retains `streaming-profile/v1` and adds the same fixed keys under each sample's `stream.phases`; the existing `stream.refresh` snapshot remains unchanged.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_streaming_telemetry_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/streaming_profile_recorder_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_streaming_runtime_budget_test.gd
```

## Dependencies

- Godot monotonic ticks and streamer lifecycle counts.

## Performance impact

One monotonic clock read pair and bounded metadata allocation run per streaming refresh. Only hitch events enter the 64-entry ring.

## Out of scope

- Full-frame/GPU timing, profiler export, automatic mitigation, and a performance-compliance claim.
