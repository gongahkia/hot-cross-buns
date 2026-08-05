# Wilderness-to-urban transition corridors

`WorldUrbanCorridors` detects chunk edges crossing between wilderness and an urban macro-region, then emits deterministic corridor records. `WorldStreamer` renders each as a non-colliding transition strip.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_corridors_test.gd
```

## Dependencies

- `WorldGenerator.region_at` macro-region classification.

## Performance impact

At most four lightweight transition meshes are added to a boundary chunk.

## Out of scope

- City-to-city transitions, authored gates, navigation solving, encounters, and biome blending.
