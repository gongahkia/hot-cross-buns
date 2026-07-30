# Industrial-ruin factories, tanks, gantries, pipes, and conveyors

`WorldIndustrialStructures` derives deterministic factory, tank, gantry, pipe, and conveyor records from `industrial_layout`. `WorldStreamer` renders colliding factories, tanks, gantries, and conveyors plus non-colliding overhead pipes.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_industrial_structures_test.gd
```

## Dependencies

- Industrial layout descriptors and `WorldRng`.

## Performance impact

Each active industrial-ruin chunk adds one factory, two tanks, one gantry, two pipes, and one conveyor.

## Out of scope

- Interior generation, functioning machinery, fluid simulation, traversal-specific routes, resources, and contamination effects.
