# Traversal-gated material placement

The `place_material` action lays a temporary route marker for one wood and one fiber. `TraversalMaterialPlacement` allows it only when the player is grounded, stabilized, near the target, and on dry terrain below the slope limit. Markers are attached to their active streamed chunk, so origin rebasing keeps them aligned and chunk eviction removes them.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/traversal_material_placement_test.gd
```

## Dependencies

- `SurvivalState` inventory
- `SpeedPlayer` traversal state
- `WorldStreamer` terrain samples and active chunk roots
- Settings input bindings

## Performance

One placement evaluation runs only when the action is pressed; each placed marker adds two render-only meshes to its active chunk.

## Out of scope

Collision-bearing bridges or platforms, crafting recipes, marker persistence, and marker retrieval.
