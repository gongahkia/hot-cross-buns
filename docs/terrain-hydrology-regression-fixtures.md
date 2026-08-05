# Terrain and hydrology regression fixtures

`world_terrain_hydrology_regression_test.gd` joins a fixed world-terrain sentinel with a deterministic local hydrology solve. The existing generator and hydrology suites remain the detailed fixtures.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_terrain_hydrology_regression_test.gd
```

## Dependencies

- World-generation fixtures, `WorldGenerator`, and `WorldHydrologyRegion`.

## Performance impact

One terrain sample and a 3×3 local solve.

## Out of scope

- Large-region performance, mesh pixels, and cross-region flow.
