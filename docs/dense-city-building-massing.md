# Dense-city building massing grammar

`WorldCityMassing` converts reclaimed-city parcels into at most eight deterministic slab, tower, or courtyard masses. Each record carries a bounded in-parcel footprint and a ruin-age/land-use-influenced height. `WorldStreamer` uses those records for visible collision boxes.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_city_massing_test.gd
```

## Dependencies

- Urban fields, parcel records, and `WorldRng`.

## Performance impact

Massing is bounded to eight records and boxes per active reclaimed-city chunk.

## Out of scope

- Facades, interiors, structural failures, rooftop ecology, and navigation meshes.
