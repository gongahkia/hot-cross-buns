# Flooded-city aquatic resource and hazard ecology

`WorldFloodedCityEcology` derives two deterministic, structure-supported aquatic resource pickups and two current/deep-water hazard records from flooded-city structures and inundation. `WorldStreamer` renders the pickups and non-colliding, group-tagged hazard markers.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_flooded_city_ecology_test.gd
```

## Dependencies

- Flooded-city inundation and structure fields plus `WorldRng`.

## Performance impact

Each active flooded-city chunk adds at most two pickup areas and two non-colliding markers.

## Out of scope

- Water simulation, boat travel, swimming, movement forces, damage, resource respawn, and aquatic AI.
