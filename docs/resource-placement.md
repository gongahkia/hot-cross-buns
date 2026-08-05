# Deterministic resource placement

`WorldResourcePlacement` derives one immutable resource record per eligible chunk from the existing seed, chunk coordinates, roll thresholds, and salts. The record contains a stable ID, kind, and local coordinates; `WorldStreamer` only instantiates a pickup from that record.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_resource_placement_test.gd
```

## Dependencies

- `WorldRng`, chunk coordinates, and region family.

## Performance impact

One fixed number of hash evaluations replaces inline placement; no additional nodes or worker jobs are created.

## Out of scope

- Picked-up resource persistence, respawn rules, and resource balancing.
