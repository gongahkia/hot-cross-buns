# Hotspot generation and trails

`WorldHotspots` builds a deterministic, toroidal mantle hotspot field from a seeded Thoth LCG. Candidates are accepted only when their toroidal distance meets the configured minimum separation, then indexed by mantle buckets.

`sample(world_x, world_z, plate, geologic_time, plate_cell_size)` follows the legacy trail model: it removes the current plate drift, evaluates historical drift positions at bounded intervals, decays older contributions exponentially, and clamps elevation contribution to `[0, 0.45]`. It reports the dominant hotspot, its trail age, intensity, and flood-basalt eligibility.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_hotspots_test.gd
```

The fixture checks LuaJIT-derived hotspot records, separation, copy isolation, repeatability, zero-time and trailed samples, flood-basalt classification, and toroidal wrapping. It exits non-zero on a mismatch.

## Dependencies

- `WorldRng` LCG for deterministic candidate sequence.
- Plate velocity/boundary data and the same cell size used by plate drift.
- Explicit hotspot options; defaults preserve the legacy count, extent, bucket, sigma, trail, and elevation parameters.

## Performance impact

Construction checks each accepted candidate against previous hotspots and is intended once per seeded world. Sampling visits only nearby buckets for each trail step; keep trail count/bucket radius bounded and reuse a field instance rather than rebuilding it per sample.

## Out of scope

- Hotspot integration into active terrain elevation, volcano meshes, persistence, or UI.
- Mantle convection simulation, hotspot birth/death, and time-varying intensity.
- GPU evaluation or global raster precomputation.
