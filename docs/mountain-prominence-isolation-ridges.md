# Mountain prominence, isolation, and ridge labels

`WorldMountainMetrics.classify(region, options)` analyzes one complete, rectangular terrain grid. It identifies eight-neighbor summit plateaus, records each summit’s topographic prominence and nearest higher ground, then writes `mountain_*` fields to summit cells and `mountain_ridge_class` to every cell.

Prominence is the summit elevation minus the highest bottleneck on any grid path to strictly higher ground. The highest summit has no higher ground: its isolation is `-1` and its prominence is measured against `base_elevation` (default `region.sea_level`, then `0`). Isolation is the Euclidean distance to the nearest strictly higher non-water cell, scaled by `stride × scale_factor`; ties use `gy`, then `gx` order.

The labels are local 3×3 morphology: `summit`, `ridge`, `saddle`, `valley`, `slope`, `edge`, or `water`. They are stable terrain descriptors, not surveyed landform names or a global ridge network.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_mountain_metrics_test.gd
```

The fixture covers exact saddle prominence, nearest-higher isolation, ridge/saddle/edge labels, plateau canonicalization, empty input, and repeatability.

## Dependencies

- Caller-owned rectangular `region.cells`, keyed or listed with unique integer `gx`/`gy` coordinates and `elevation_base` or `elevation`.
- Optional positive `stride`, `scale_factor`, and `base_elevation` values.
- The prominence/isolation definitions recorded in [research-citation-registry.md](research-citation-registry.md).

## Performance impact

For `n` cells and `p` summit plateaus, classification uses O(n) storage and O(p × n log n) time for exact bounded-grid saddles, plus O(p × n) isolation scans. Run it after a bounded terrain region is finalized; it is not attached to per-frame sampling.

## Out of scope

- Global DEM processing, cross-region continuity, and unbounded isolation/prominence claims.
- Mesh generation, route selection, hydrology changes, or terrain elevation mutation.
- Empirical terrain validation, calibrated mountain taxonomy, or scientific simulation claims.
