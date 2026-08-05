# Köppen classification

`WorldKoppen.classify` ports Thoth’s normalized-temperature/precipitation Köppen thresholds, including latitude and monsoon modifiers. `apply` writes `koppen` to a caller-owned cell.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_koppen_test.gd
```

The fixture covers polar, arid, tropical, temperate, and continental branches.

## Dependencies

- Temperature, precipitation/rainfall, latitude, and optional monsoon index.

## Performance impact

Constant time per cell.

## Out of scope

- Biome assignment, climate solving, and weather variation.
