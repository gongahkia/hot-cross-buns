# Dense-city facade and roof traversal grammar

`WorldCityTraversal` derives a facade ledge and roof-route class for each massed reclaimed-city building. `WorldStreamer` adds the ledges as collision boxes; building top faces remain the matching roof traversal surface.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_traversal_test.gd
```

## Dependencies

- Building-massing records and `WorldRng`.

## Performance impact

One facade and roof record, plus one small collision box, are added per massed building.

## Out of scope

- Interior traversal, jump reachability solving, dynamic doors, and structural failure.
