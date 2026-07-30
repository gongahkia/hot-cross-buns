# Coarse-basin hydrology

`WorldCoarseBasin.solve(sample_cell, chunk_x, chunk_y, options)` ports the coarse hydrology pass. It derives a stride-aware basin region around a chunk, samples cells at stride centers, seeds rainfall flow, runs soil sync, priority-flood/D8 routing, and reverse accumulation with the source basin’s `0.985` factor. It then assigns terminal basin IDs, channel IDs, and source threshold-based river flags.

`flow_for(region, gx, gy, options)` ports the coarse-channel projection used by local hydrology: it maps a detailed coordinate to a coarse channel segment, applies the source width falloff, threshold excess, stride normalization, and default `0.6` scale.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_coarse_basin_test.gd
```

The fixture checks coarse-grid sizing, basin terminals, river accumulation, channel projection, disabled settings, and negative-region mapping.

## Dependencies

- A `Callable` returning a fresh cell dictionary with base elevation and rainfall/precipitation for each world coordinate.
- Priority flood, flow accumulation, and soil production.

## Performance impact

The basin solve is `O(n log n)` in the configured coarse grid; channel projection is constant time. No cache is owned by this module, so callers control reuse and eviction.

## Out of scope

- Climate generation, erosion/hillslope/glacier solves, cache policy, and automatic injection of projected flows into detail regions.
- Lake grouping, detailed river landforms, and terrain-generator integration.
