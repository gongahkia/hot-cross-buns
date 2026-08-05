# Tensor-guided dense-city arterial roads

`WorldCityArterials` converts reclaimed-city macro-layout slope/axis data into a diagonal-free local orientation tensor and two arterial records. Primary offsets are keyed only by their cross-axis coordinate, keeping a road continuous across its chunk seam. `WorldStreamer` renders those records as non-colliding road overlays.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_arterials_test.gd
```

## Dependencies

- Reclaimed-city macro layout and `WorldRng`.

## Performance impact

Each reclaimed-city descriptor adds four hash lookups and two road records; active reclaimed-city chunks add two small overlay meshes.

## Out of scope

- Curved roads, intersections, traffic, secondary roads/alleys, and road collision geometry.
