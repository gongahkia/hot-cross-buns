# Wind and orographic precipitation

`WorldClimate.solve_region` ports the deterministic downwind moisture solve: baseline climate bands, terrain lift/lee drying, monsoon adjustment, rain shadows, precipitation, and per-cell sample records.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_climate_test.gd
```

## Dependencies

- `WorldClimateBands`, a complete terrain lattice, and optional climate parameters.

## Performance impact

One sorted pass over region cells with constant-time neighborhood gradients.

## Out of scope

- Weather variation, climate interpolation queries, and biome assignment.
