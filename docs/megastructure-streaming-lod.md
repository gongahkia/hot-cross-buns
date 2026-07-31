# Megastructure streaming LOD contract

`WorldMegastructureLod.compile` converts a chunk's data-only `megastructure-chunk/v1` intersections into `megastructure-lod/v1` records. It creates four ordered, JSON-safe arrays:

- `macro_silhouettes`: clipped macro roof/floor extents for far terrain.
- `sector_shells`: opening-sector enclosure extents and only the macro faces without a structural continuation port.
- `active_collisions`: macro enclosure extents and the same exterior-face set for active collision work.
- `traversal_details`: chunk-clipped route segments with fixed-point endpoints and route metadata.

`WorldMegastructureIntersection` owns route clipping. Its `traversal_segments` use `point_fp` coordinates at 1/1024 world-unit precision; no scene nodes, cache state, timing, or loaded-neighbor state enters the contract. The generator stores the compiled result under `chunk_descriptor.megastructure_lod` and the worker carries it unchanged.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_lod_test.gd
```

The test checks direct compilation against the worker payload shape, all four phase arrays, enclosure elevations, JSON serialization, and fresh-descriptor isolation.
