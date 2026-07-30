# Dense-city rooftop resource ecology

`WorldCityRooftopResources` places at most one deterministic food, water, or scrap pickup per surviving reclaimed-city mass. Courtyards produce food; other roof resources vary between water and scrap. Collapsed roofs are excluded.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_rooftop_resources_test.gd
```

## Dependencies

- Building masses, structural failure records, urban fields, and `WorldRng`.

## Performance impact

Only selected surviving masses create a standard pickup node; no extra physics body type or worker job is introduced.

## Out of scope

- Resource persistence after collection, regrowth, balancing, and inaccessible-roof recovery.
