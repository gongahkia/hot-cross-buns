# City-to-city transition corridors

`WorldCityCorridors` detects chunk edges crossing between distinct non-wilderness macro-region families and emits deterministic city-transition corridors. `WorldStreamer` renders each as a non-colliding strip.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_corridors_test.gd
```

## Dependencies

- `WorldGenerator.region_at` macro-region classification.

## Performance impact

At most four lightweight transition meshes are added to an urban boundary chunk.

## Out of scope

- Wilderness transitions, authored district gates, navigation solving, and biome blending.
