# River, bank, floodplain, delta, and fan classification

`WorldRiverLandforms.apply(region, options)` ports Thoth’s threshold/macro-channel river selection, bank labeling, floodplain/deposition, delta-mouth detection, alluvial-fan criteria, and fan-lobe spread. It also promotes qualifying lake outlets from `lake_groups` to river/floodplain contexts.

The pass writes `river`, `river_bank`, `floodplain`, `delta`, `alluvial_fan`, `alluvial_fan_lobe`, and `deposition` to caller-owned cells.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_river_landforms_test.gd
```

The fixture checks river/delta/floodplain detection, bank labeling, alluvial-fan lobe spread, and summary counts.

## Dependencies

- Hydrology flow, D8 downstream links, slope, water, and base-elevation fields.
- Sediment/tectonic fields for fans and optional lake groups for outlet promotion.

## Performance impact

The pass uses a constant number of linear cell scans and eight-neighbor checks for river/fan cells. It allocates only its statistics dictionary.

## Out of scope

- Priority flood, lake grouping, braided/meandering rivers, erosion, sediment generation, coastal morphology, and terrain integration.
