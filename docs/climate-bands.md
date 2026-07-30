# Climate bands and latitude model

`WorldClimateBands` ports geographic/legacy latitude mapping, geographic Coriolis, seasonal ITCZ displacement, the 181 deterministic climate bands, pressure-cell IDs, baseline precipitation, and normalized baseline wind vectors.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_climate_bands_test.gd
```

The fixture checks geographic and legacy latitude branches, Coriolis, all band construction, pressure classifications, normalized winds, and repeatability.

## Dependencies

- Seed, world circumference, rotation rate, geologic time, seasonal rate, ITCZ amplitude, and wind-Coriolis scale supplied at construction.

## Performance impact

Construction creates 181 constant-size band records; point lookup is constant time.

## Out of scope

- Orographic moisture transport, rain-shadow solving, climate cache interpolation, weather variation, and biome assignment.
