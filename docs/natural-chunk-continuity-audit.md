# Natural chunk-boundary continuity audit

`WorldStreamer` builds both mesh and `HeightMapShape3D` boundary vertices from the same absolute `WorldGenerator.sample` coordinate. The deterministic seam fixture covers negative and positive chunk boundaries and repeatable descriptors.

## Audit decision

- Terrain height and collision share the same grid and boundary samples.
- Natural descriptors are coordinate-derived and do not depend on load order.
- Per-chunk biome materials and independently placed features may create intentional visual-category transitions; this audit does not claim pixel-perfect blending.
- Future LOD, worker, origin-rebase, and feature systems must retain absolute boundary sampling and add seam coverage in their owning issues.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_chunk_continuity_test.gd
```

## Dependencies

- `WorldGenerator` chunk size and deterministic coordinate sampling; `WorldStreamer` mesh/collision construction.

## Performance impact

The fixture is bounded and has no runtime impact.

## Out of scope

- Pixel screenshot comparison, LOD stitching, feature overlap avoidance, and runtime collision traversal.
