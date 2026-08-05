# Thirst, water sourcing, purification, and contamination

`collect_water_source()` recognizes water and freshwater-adjacent biomes. Flooded-city, industrial, wetland, lagoon, and mangrove sources yield `dirty_water`; `purify_water()` converts it to drinkable water; `consume_water()` restores `42` thirst. Actions default to `2` source, `3` purify, and `4` drink.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_water_test.gd
```

## Dependencies

- `SurvivalState`, procedural sample metadata, main-run input processing, and Settings bindings.

## Performance impact

- One cached procedural sample and three input checks per active procedural frame.

## Out of scope

- Containers, fuel, boiling animation, salinity, disease, environmental spread, and water physics.
