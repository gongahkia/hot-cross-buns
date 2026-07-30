# Soil-order classification

`WorldSoilClassification` ports the ten land soil orders and no-soil water value: Entisol, Inceptisol, Mollisol, Vertisol, Aridisol, Histosol, Spodosol, Oxisol, Andisol, Ultisol, and None. Classification follows Thoth’s priority order from hydric/volcanic/arid exclusions through regolith, climate, age, lithology, biome, and slope conditions.

`apply_region` writes `soil_order` to each caller-owned cell and returns land-cell counts by soil ID. The GDScript port uses snake-case source fields, including `regolith_depth`, `plate_age`, `lithology_age`, `is_flood_basalt`, `volcanic_form`, and `hotspot_contribution`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_soil_classification_test.gd
```

The fixture checks every source-defined soil-order fixture, water handling, regional counts/writeback, and static-data copy isolation.

## Dependencies

- Climate, slope, water/flow, biome, lithology, plate/lithology age, and regolith fields supplied by upstream systems.
- Soil-production output when regolith depth is generated dynamically.

## Performance impact

Classification is constant-time branching per cell. Regional application is linear in caller-supplied cell count and allocates only its summary dictionary.

## Out of scope

- Soil production, erosion, sediment transport, hydrology, persistent soil storage, and terrain/material rendering.
- Calibrating generated-world distributions against the reference target frequencies.
