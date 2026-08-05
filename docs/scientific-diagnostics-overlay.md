# Scientific model diagnostics overlay

F3 now includes the active procedural sample: normalized elevation, temperature, rainfall, biome, water state, scale, and deterministic region identity. It reports only fields supplied by the active generator; unavailable model fields are not inferred.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_diagnostics_test.gd
```

## Dependencies

- `WorldStreamer.sample_at`, `WorldGenerator`, and the existing F3 debug HUD.

## Performance impact

One existing local sample and bounded text formatting while F3 is visible.

## Out of scope

- Scientific validation, charts, persistent telemetry, and rendering every ported intermediate field.
