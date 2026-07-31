# Megastructure streaming LOD contract

`WorldMegastructureLod.compile` converts a chunk's data-only `megastructure-chunk/v1` intersections into `megastructure-lod/v1` records. It creates four ordered, JSON-safe arrays:

- `macro_silhouettes`: clipped macro roof/floor extents for far terrain.
- `sector_shells`: opening-sector enclosure extents and only the macro faces without a structural continuation port.
- `active_collisions`: macro enclosure extents and the same exterior-face set for active collision work.
- `traversal_details`: chunk-clipped route segments with fixed-point endpoints and route metadata.

`WorldMegastructureIntersection` owns route clipping. Its `traversal_segments` use `point_fp` coordinates at 1/1024 world-unit precision; no scene nodes, cache state, timing, or loaded-neighbor state enters the contract. The generator stores the compiled result under `chunk_descriptor.megastructure_lod` and the worker carries it unchanged.

`WorldStreamer` attaches these records without a new queue: macro silhouettes are added inside `_update_far_terrain`; shells are added while `_build_pending_chunks` admits the active root; active collision is deferred through `_update_collision_lods`; traversal guides and F4 boundary markers are added by `_build_pending_features`. Normal frames retain the existing active > collision > background gate. `refresh(true)` remains the synchronous initialization exception.

Shell walls are emitted only on faces without a structural continuation port or a route endpoint. This leaves the generated entry/exit openings passable while roofs and remaining exterior faces enclose the flat interior. The prior always-loaded `MegastructurePrototype` is no longer attached at expedition startup; pure prototype tests remain as the M2 fixture.

`WorldGenerator.megastructure_reveal_priority` is a pure cached-descriptor query. It assigns the descriptor's reveal bias at background, twice that bias at focus, and three times that bias at foreground or the recommended view anchor; zero-thickness reveal planes intersect both touching chunk boundaries. `WorldStreamer` uses that score only to sort existing worker, active, collision, far, and detail candidates. It adds no queue or frame-budget exception.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_lod_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_reveal_priority_test.gd
```

The test checks direct compilation against the worker payload shape, all four phase arrays, enclosure elevations, JSON serialization, and fresh-descriptor isolation.
