# Priority-flood depression filling

`WorldPriorityFlood.fill(region, options)` ports Thoth’s eight-neighbor, boundary-seeded priority flood. It writes `filled_elevation`, `down_cell`, and `down_distance` to caller-owned cells, preserving every base elevation while raising depressions to their lowest drainable spill level.

Cells must form a complete rectangular `gx`/`gy` grid and provide `elevation_base` (or `elevation`). `stride` and `scale_factor` scale routing distance; both default to one. Each call clears prior routing state before solving.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_priority_flood_test.gd
```

The fixture checks a closed depression’s spill height, full-grid visitation, non-decreasing filled elevations, non-uphill routes, distance scaling, and empty input.

## Dependencies

- A caller-created rectangular hydrology-region grid with stable integer coordinates and base elevations.

## Performance impact

The binary-heap solve is `O(n log n)` for `n` cells, with one heap entry and up to eight neighbor visits per cell. It keeps only temporary grid, heap, and visit-order containers.

## Out of scope

- Flow accumulation, river/lake classification, erosion, climate, cross-region routing, and active terrain-generator integration.
- Partial or non-rectangular grids; these fail fast to retain the source solver’s closed-region assumptions.
