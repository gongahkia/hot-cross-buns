# Local hydrology-region solve

`WorldHydrologyRegion.solve(region, options)` composes the source local-solve core: priority-flood/D8 routing, rainfall-plus-`basin_flow` seeding, reverse-order accumulation with the local solver’s `0.965` transmission factor, and hydrologic slope derivation. It stores the result under `region.hydrology` and updates `flow`, `hydro_slope`, and `slope` on caller-owned cells.

The region must meet the priority-flood rectangular `gx`/`gy` grid contract. It may specify `scale`, `scale_factor`, and per-cell `basin_flow`; options override the scale fields. `river_threshold(scale_id)` retains the source local/region/continent thresholds for downstream classification.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_hydrology_region_test.gd
```

The fixture checks scale-aware thresholds, full routing/accumulation composition, headwater-to-outlet transfer, and derived hydrologic slope.

## Dependencies

- Priority-flood D8 routing and flow accumulation.
- A caller-created local rectangular region with base elevation and rainfall/precipitation fields.
- Optional coarse-basin input supplied as `basin_flow`.

## Performance impact

The solve is dominated by the priority-flood `O(n log n)` heap pass; flow and slope passes are linear. It mutates cell fields and retains the priority-flood visit order in the region.

## Out of scope

- Coarse-basin generation, lake grouping/spillover, river/bank/floodplain/delta/fan classification, erosion, meanders, coastal features, and terrain integration.
- Sampling world cells or caching regions; callers own region construction and lifecycle.
