# Plate drift and geologic time

`WorldPlates` owns a per-instance `geologic_time`. A center’s time-zero position is displaced independently on each axis:

```text
drift = tanh(velocity × geologic_time) × plate_cell_size × 0.4
```

The hyperbolic tangent keeps each axis strictly within 40% of a plate cell, preventing drift from moving a center across more than its local neighborhood. `WorldPlates.drift(...)` exposes the vector calculation, and `set_geologic_time(...)` invalidates cached centers only when the time value changes exactly.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_plate_drift_test.gd
```

The fixture checks LuaJIT-derived time-zero and time-3.5 center positions, helper agreement, zero-time behavior, bounded drift, cache invalidation, rebuild, and no-op updates. It exits non-zero on a mismatch.

## Dependencies

- Deterministic plate velocity from `WorldPlates` classification.
- The fixed plate-cell size, used both for center spacing and the bounded drift scale.

## Performance impact

Drift adds two `tanh` evaluations per cold center build. A geologic-time change clears the plate cache, making the next queried neighborhood cold; advance time in explicit generation epochs rather than every rendered frame.

## Out of scope

- Time-varying velocity, plate splitting/merging, collision resolution, or mantle advection.
- Updating active streamed terrain, saves, or generation schema during a running expedition.
- Interpolating between two independently cached geologic-time epochs.
