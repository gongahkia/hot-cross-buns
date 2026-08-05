# World-generation golden fixtures

`levels/world-generation-fixtures.v1.json` fixes representative seed/coordinate outputs for `WorldGenerator`. The headless test checks elevation, temperature, rainfall, biome, water classification, region metadata, and chunk descriptors for positive/negative coordinates, a region boundary, and a negative seed.

Changing a fixture is a generation compatibility decision. Update the seed-version policy first, explain the intentional output change in the commit/issue, and regenerate every affected expected value from the reviewed implementation.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_generation_golden_test.gd
```

## Dependencies

- `WorldGenerator`, its deterministic `WorldRng` calls, and fixed chunk/region size constants.
- The seed/version compatibility policy, which defines when changed goldens require a version boundary.

## Performance impact

The test evaluates a bounded number of samples and chunk descriptors only. It performs no streaming, mesh construction, physics collision, renderer, or disk I/O beyond loading its small fixture file.

## Out of scope

- Visual meshes, node hierarchy, resource placement, physics simulation, screenshot pixels, and frame timing.
- Exhaustive coverage of every seed or coordinate; these are regression sentinels, not a proof over the infinite world.
- Automatic fixture regeneration in CI.
