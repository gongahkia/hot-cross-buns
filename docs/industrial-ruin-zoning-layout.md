# Industrial-ruin zoning and site layout

`WorldIndustrialLayout` derives a deterministic industrial zone, service axis, ruin age, and four bounded site records from existing industrial urban fields. The descriptor supports later structural generation without adding scene nodes.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_industrial_layout_test.gd
```

## Dependencies

- Industrial `WorldUrbanFields` records and `WorldRng`.

## Performance impact

Four small dictionaries are added only to industrial-ruin chunk descriptors.

## Out of scope

- Factories, tanks, gantries, pipes, conveyors, collision, traversal routes, resources, and contamination behavior.
