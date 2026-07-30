# Collision-mesh LOD

`WorldCollisionLod` selects 16×16, 8×8, or 4×4 `HeightMapShape3D` grids by chunk distance. `WorldStreamer` stores the selected collision grid on each chunk root and builds the shape and transform at that resolution.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_collision_lod_test.gd
```

## Dependencies

- Canonical chunk distance, terrain sampling, `WorldCollisionMesh`, and Godot `HeightMapShape3D`.

## Performance impact

A 5×5 active window builds 2,381 collision heights instead of 7,225 at 16×16 throughout: 67% fewer height samples. Collision approximation becomes coarser with distance.

## Out of scope

- LOD handoff safeguards, collision/visual stitching, and changes to active-window radius.
