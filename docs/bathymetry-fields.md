# Bathymetry, shelf, canyon, and seamount fields

`WorldBathymetry.apply` ports deterministic shelf-canyon selection and downhill ocean incision. It writes `submarine_canyon`, modified elevation/bedrock fields, and `region.bathymetry`. `is_shelf` exposes the source shelf predicate. `seamount_at` ports the deterministic oceanic seamount contribution used by `WorldTectonics`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_bathymetry_test.gd
```

The fixture checks shelf eligibility, a forced canyon path, oceanic seamount generation, and continental rejection.

## Dependencies

- Canyons require a complete water/land lattice with elevation, shelf distance, lake state, flow/threshold, and sea level.
- Seamounts require world coordinates, scale factor, plate crust, and shelf proximity.

## Performance impact

Canyon candidate selection is linear plus deterministic sorting; each canyon follows at most 16 cells. Seamount sampling checks a fixed 3×3 lattice neighborhood.

## Out of scope

- Ocean-current simulation, bathymetric meshing, sediment transport, and marine biome assignment.
