# Collision handoff

When a chunk crosses a collision-LOD boundary, `WorldStreamer` adds the replacement `CollisionShape3D` before renaming and retaining the former shape. The former shape is released only after the next `SceneTree.physics_frame`, so there is no physics tick without terrain support.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_collision_lod_test.gd
```

## Dependencies

- `WorldCollisionLod`, `WorldCollisionMesh`, Godot scene-tree ordering, and `SceneTree.physics_frame`.

## Performance impact

Each changed chunk has two terrain collision shapes for at most one physics tick. Normal steady-state collision cost is unchanged.

## Out of scope

- Continuous collision morphing, visual LOD transitions, and remote-chunk collision.
