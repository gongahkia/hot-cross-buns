# Plate properties and boundary classification

`WorldPlates.center(cell_x, cell_z)` now carries the deterministic, time-zero properties of a plate center:

- velocity from a seeded direction (`salt 41`) and speed in `[0.25, 1.0)` (`salt 43`);
- crust type from `salt 47` (`continental` above `0.66`, otherwise `oceanic`);
- normalized age from `salt 49`.

`nearest(world_x, world_z)` evaluates the legacy 3×3 neighboring center cells. `plate_at` classifies the nearest pair’s normalized boundary width, convergence/divergence, crust pairing, and the current side’s subduction fields. It returns both primary and secondary IDs/properties so later terrain systems do not need to repeat nearest-neighbor work.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_plate_classification_test.gd
```

The fixture checks LuaJIT-derived center velocity/crust/age and oceanic-convergent, continental-divergent, and mixed-crust boundary cases. It also checks repeatability and negative-coordinate nearest lookup, exiting non-zero on a mismatch.

## Dependencies

- `WorldPlates` center cache and the Thoth-compatible hash/unit primitives.
- Fixed plate-cell size and the legacy 3×3 nearest-neighbor search radius.

## Performance impact

`plate_at` visits nine plate-center cells. After warm-up these are cache hits; a cold lookup creates the nine records and may update the bounded LRU. Reuse a `WorldPlates` instance for related samples rather than constructing one per point.

## Out of scope

- Geologic-time drift of center positions and velocity trajectories.
- Hotspots, ocean depth, erosion, hydrology, or integration into the active terrain generator.
- Global Voronoi preprocessing or cross-thread cache sharing.
