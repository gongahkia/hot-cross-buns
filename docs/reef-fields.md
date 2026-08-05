# Reef, lagoon, and atoll fields

`WorldReefs.apply` ports warm shallow-water eligibility, local deterministic reef ages, accretion/subsidence, and fringing/barrier/atoll/lagoon/submerged stages. It writes `reef_accretion`, `reef_age_my`, `reef_stage`, optional reef uplift, and `region.reefs`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_reefs_test.gd
```

The fixture checks all five source reef stages under deterministic forced subsidence.

## Dependencies

- A complete water/land lattice with elevation, lake state, temperature, latitude, ocean-depth, hotspot, and geologic-time fields.

## Performance impact

Each eligible candidate scans a bounded 9×9 local seed window and up to two bounded land-neighborhood windows.

## Out of scope

- Coral mesh generation, marine ecology, fluid simulation, and final biome/render assignment.
