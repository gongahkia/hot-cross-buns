# World scale hierarchy

`WorldScale` defines the Thoth hierarchy:

| Scope | Factor | Meaning |
| --- | ---: | --- |
| `local` | 1 | full world-coordinate sampling |
| `region` | 4 | samples snap to four-world-unit cells |
| `continent` | 16 | samples snap to sixteen-world-unit cells |

`WorldGenerator.sample(x, z, scope)` preserves continuous local sampling and adds `scale`, `scale_factor`, `sample_x`, and `sample_z` metadata. Non-local scopes floor-snap both coordinates, including negative coordinates. `chunk_descriptor` scales its chunk-center spacing by the same factor. Unknown IDs/factors resolve to `local`, matching the legacy default.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_scale_test.gd
```

The fixture verifies scale lookup, negative-coordinate quantization, local compatibility, region/continent golden samples, and a scaled chunk descriptor. It exits non-zero on a mismatch.

## Dependencies

- `WorldScale` is the single source for hierarchy IDs, factors, coordinate conversion, and scaled chunk centers.
- `WorldGenerator` retains ownership of terrain/region classification and seeded RNG sampling.
- Seed-version compatibility policy governs changes to any fixed-scale output.

## Performance impact

Scope resolution adds one small dictionary lookup and non-local coordinate floors before the existing sample work. Local streamer calls keep factor `1`, so they retain their previous terrain coordinates and mesh extent.

## Out of scope

- Replacing current local terrain formulas with the larger legacy geology system.
- Cross-scale interpolation, parent/child caches, LOD mesh stitching, or automatic scope selection by camera distance.
- Changing the active streamer from local scope.
