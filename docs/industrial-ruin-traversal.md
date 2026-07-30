# Industrial-ruin elevated traversal routes

`WorldIndustrialTraversal` derives a factory-roof catwalk, gantry catwalk, and stepped factory access route from industrial layout and structure records. `WorldStreamer` renders all routes as collision geometry.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_industrial_traversal_test.gd
```

## Dependencies

- Industrial layout/structure descriptors and `WorldRng`.

## Performance impact

Each active industrial-ruin chunk adds two catwalk collision boxes and five access-step boxes.

## Out of scope

- Navigation solving, route reachability validation, ladders, moving machinery, and grappling-specific links.
