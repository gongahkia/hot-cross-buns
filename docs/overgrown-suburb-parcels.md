# Overgrown-suburb parcels, homes, yards, and utilities

`WorldSuburbParcels` derives four road-aware parcels with homes and yards plus two utility poles. `WorldStreamer` renders yard overlays and colliding homes/utilities, replacing the former fixed suburb placeholders.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_suburb_parcels_test.gd
```

## Dependencies

- Overgrown-suburb urban fields, road descriptors, and `WorldRng`.

## Performance impact

Each active overgrown-suburb chunk adds four yard meshes, four home collision boxes, and two utility collisions.

## Out of scope

- Interior generation, utility simulation, route transitions, vegetation, resources, and collapse behavior.
