# Industrial-ruin contamination and hazard fields

`WorldIndustrialHazards` derives two deterministic contamination fields from the factory and tank records. `WorldStreamer` renders group-tagged, non-colliding hazard markers with source and intensity metadata.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_industrial_hazards_test.gd
```

## Dependencies

- Industrial layout/structure descriptors and `WorldRng`.

## Performance impact

Each active industrial-ruin chunk adds two non-colliding hazard markers.

## Out of scope

- Damage, health effects, spread, remediation, fluid simulation, and hazard AI.
