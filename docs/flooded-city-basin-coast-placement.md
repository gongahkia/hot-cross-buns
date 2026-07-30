# Flooded-city basin and coast placement

`WorldFloodedCityBasin` adds a deterministic basin record to flooded-city chunk descriptors. Center and four-neighbor terrain/water probes classify coastal versus inland placement, shoreline axis, adjacent water count, and local below-zero basin depth.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_flooded_city_basin_test.gd
```

## Dependencies

- Flooded-city region family and canonical terrain/water samples.

## Performance impact

Flooded-city descriptor construction adds four deterministic terrain samples. Other descriptor families are unchanged.

## Out of scope

- Inundation depth/current fields, water rendering, hydrodynamics, and structure placement.
