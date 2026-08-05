# Braided-river and meander classification

`WorldRiverPatterns.apply(region, options)` ports Thoth’s overloaded-channel braided-river criteria and deterministic lowland-meander pass. Braiding uses sediment load/capacity, slope, flow, and river state. Meanders collect D8 river segments, derive width/curvature, apply Thoth-hash phase migration, mark floodplain bends, and stamp valid oxbow targets.

The pass writes `braided_river`, `meander_bend`, `oxbow_lake`, and optional oxbow polygons; braided cells retain the source deposition uplift.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_river_patterns_test.gd
```

The fixture checks braided criteria/deposition, deterministic meander bends, lowland sinuosity, and oxbow count consistency.

## Dependencies

- River/bank classification, D8 links, flow, slope, water, and sediment fields.
- Thoth-compatible hash primitives for deterministic meander phase.

## Performance impact

Braiding is linear. Meandering is linear in river cells plus segment length, with eight-neighbor-free segment tracing and only local coordinate lookups for oxbows.

## Out of scope

- River routing, sediment generation, bank erosion, terrain deformation, cross-region segment stitching, and rendering.
