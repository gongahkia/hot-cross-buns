# Lake grouping and spillover routing

`WorldLakes.apply(region, options)` ports Thoth’s lake candidate, connected-group, and spillover labeling pass. It derives lakes from `filled_elevation` over `elevation_base`, retains cenote behavior, joins eight-neighbor lake cells, follows D8 links to the first non-lake outlet, then writes group and spillover fields to the lake cells and outlet.

The port uses `lake_id`, `lake_group_size`, `lake_max_depth`, `lake_surface`, `outlet_gx`, `outlet_gy`, `spillover`, `spillover_lake_id`, `spillover_elevation`, and `spillover_flow`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_lakes_test.gd
```

The fixture checks two-cell lake grouping, outlet/spillover labels, water state, and the source cenote exception.

## Dependencies

- Priority-flood/D8 output: `filled_elevation` and `down_cell`.
- A region cell map keyed by `gx:gy`, with base elevation and optional flow/cenote fields.

## Performance impact

Candidate marking and grouping are linear in region-cell count; each lake cell is visited once. The pass retains only group arrays and temporary DFS state.

## Out of scope

- Depression filling, river/floodplain/delta classification, erosion, meanders, terrain integration, and cross-region lake merging.
