# Dense-city structural failure and collapsed routes

`WorldCityFailures` classifies each massed reclaimed-city building as intact, partial, or collapsed from ruin age and a deterministic roll. Partial/collapsed masses reduce collision height; collapsed masses receive a three-step debris route, while ledges above the surviving mass are omitted.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_failures_test.gd
```

## Dependencies

- Urban ruin age, building massing, and facade traversal records.

## Performance impact

One failure record per massed building. Only collapsed buildings add three small collision boxes.

## Out of scope

- Runtime destruction, falling debris, damage, evacuation logic, and reachability solving.
