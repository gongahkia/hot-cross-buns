# Far terrain impostors

`WorldFarTerrain` creates a deterministic 11×11 chunk window around the current center. The inner active 5×5 window is excluded. Each of the 96 outer chunks is a collision-free 2×2 terrain heightfield with its deterministic biome/region material; it contains no gameplay features.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_far_terrain_test.gd
```

## Dependencies

- Canonical chunk coordinates, `WorldGenerator` sampling, and `WorldStreamer` mesh/material construction.

## Performance impact

Each impostor has 24 vertices, versus 1,536 at a 16×16 grid. The 96-chunk outer ring adds 2,304 vertices and no physics bodies.

## Out of scope

- Occlusion culling, terrain stitching, vegetation impostors, and remote collision.
