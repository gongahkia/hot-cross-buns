# Natural-biome resource ecology

`WorldNaturalResources` replaces wilderness’ generic pickup with up to two deterministic biome records. Forests yield wood, fiber, or food; arid and alpine biomes yield fiber, scrap, or water; wet biomes yield fiber, food, or water. Water cells produce no land resources.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_natural_resources_test.gd
```

## Dependencies

- world seed, chunk coordinates, biome, and region family
- `WorldGenerator` descriptors
- `WorldStreamer` resource pickups

## Performance

Two bounded hash rolls per wilderness chunk; no extra streaming jobs.

## Out of scope

Respawns, harvesting, carrying capacity, food quality, and urban resource ecology.
