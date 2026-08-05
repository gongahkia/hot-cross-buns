# Deterministic hazard placement

`WorldHazardPlacement` derives at most one immutable hazard record per eligible chunk from biome, region family, seed, and chunk coordinates. `WorldStreamer` instantiates a readable, non-colliding marker carrying the stable hazard ID and kind.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_hazard_placement_test.gd
```

## Dependencies

- Biome/family classification and `WorldRng`.

## Performance impact

Eligible chunks use three fixed hash evaluations and, when selected, one marker mesh. No physics body or worker job is added.

## Out of scope

- Damage, survival effects, hazard ecology, collision, and picked/cleared state.
