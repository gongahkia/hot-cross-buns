# Flooded-city submerged structure and collapse fields

`WorldFloodedCityStructures` derives four deterministic flooded-city structure records with footprint, original height, collapse state, surviving-height scale, and inundation-scaled submerged depth. `WorldStreamer` renders matching degraded collision masses.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_flooded_city_structures_test.gd
```

## Dependencies

- Flooded-city inundation fields and `WorldRng`.

## Performance impact

Each active flooded-city chunk creates four structure boxes, replacing the prior generic flooded blocks.

## Out of scope

- Physics buoyancy, dynamic collapse, interiors, salvage, and aquatic ecology.
