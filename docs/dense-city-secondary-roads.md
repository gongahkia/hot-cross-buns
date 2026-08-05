# Dense-city secondary roads and alleys

`WorldCitySecondaryRoads` fills reclaimed-city blocks with arterial-clear secondary roads and deterministic alleys. Records sharing an axis are keyed only by their cross-axis coordinate, keeping their offsets stable across the corresponding chunk seam. `WorldStreamer` renders them as non-colliding overlays.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_secondary_roads_test.gd
```

## Dependencies

- Urban fields, arterial records, and `WorldRng`.

## Performance impact

An eligible descriptor tests eight candidate lanes and adds only accepted records. Active reclaimed-city chunks add one small overlay mesh per accepted lane.

## Out of scope

- Intersections, road collision, traffic, sidewalks, and parcel/building generation.
