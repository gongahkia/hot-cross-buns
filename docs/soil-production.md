# Soil production

`WorldSoilProduction` ports Thoth’s exponential soil-production model. `steady_state_depth` derives regolith depth from erosion rate; `step` advances caller-owned region cells while preserving surface elevation and the `bedrock_elevation + regolith_depth = elevation` invariant. `sync_cell` and `sync_region` restore that invariant without advancing time.

The GDScript port uses snake-case cell/options fields: `regolith_depth`, `bedrock_elevation`, `elevation_base`, `soil_erosion_rate`, `h_star`, `bulking_ratio`, `dt_years_scale`, `slope_erosion_scale`, and `base_erosion_rate`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_soil_production_test.gd
```

The fixture checks source-derived steady-state values, threshold behavior, slope-sensitive production, aggregate statistics, the bedrock/regolith invariant, and zero-time synchronization.

## Dependencies

- Caller-owned cells with elevation and slope fields.
- A simulation caller to supply elapsed geologic time and, optionally, erosion rates.

## Performance impact

Each step is linear in region-cell count with constant-time scalar math per cell. It allocates only the returned statistics dictionary and mutates supplied cells in place.

## Out of scope

- Erosion-rate calculation, soil-order classification, sediment transport, hydrology, and terrain-generator integration.
- Persistent soil state and rendering/material selection.
