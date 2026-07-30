# Urban-region resource ecology

`WorldUrbanResources` exposes a normalized descriptor contract for reclaimed-city rooftop, flooded-city aquatic, industrial salvage, and overgrown-suburb salvage resources. Existing family renderers remain authoritative for placement and collision; the contract lets survival, journals, and run records inspect regional resource identity uniformly.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_resources_test.gd
```

## Dependencies

- family-specific resource generators
- `WorldGenerator` chunk descriptors
- family-specific `WorldStreamer` renderers

## Performance

Descriptor normalization only copies bounded resource metadata during chunk generation.

## Out of scope

Respawns, resource balancing, capacity, harvesting, and pickup persistence.
