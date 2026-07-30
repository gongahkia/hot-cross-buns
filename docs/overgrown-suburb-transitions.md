# Overgrown-suburb interior and exterior transitions

`WorldSuburbTransitions` derives one road-facing entry and interior counterpart per home. `WorldStreamer` now renders homes as door-open collision shells and adds porch/step collision routes, so exterior and interior terrain volumes connect.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_suburb_transitions_test.gd
```

## Dependencies

- Overgrown-suburb road and parcel/home descriptors.

## Performance impact

Each active overgrown-suburb chunk adds four home shells and four porch/step transition routes.

## Out of scope

- Furnishings, room layouts, doors, locks, navigation solving, and interior lighting.
