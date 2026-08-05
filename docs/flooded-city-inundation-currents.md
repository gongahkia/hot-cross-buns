# Flooded-city inundation depth and currents

`WorldFloodedCityInundation` derives a deterministic local inundation depth and a single shoreline-axis current vector from a flooded-city basin record. The data is descriptor-only and does not alter terrain or player movement.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_flooded_city_inundation_test.gd
```

## Dependencies

- Flooded-city basin records and `WorldRng`.

## Performance impact

Three fixed hash evaluations are added only to flooded-city descriptors.

## Out of scope

- Water rendering, buoyancy, movement forces, damage, and fluid simulation.
