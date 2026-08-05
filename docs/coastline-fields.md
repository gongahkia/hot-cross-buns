# Coastline, beach, cliff, and longshore fields

`WorldCoast.apply` ports Thoth shoreline extraction, coast-normal exposure, beach/cliff classification, and deterministic longshore instability. It writes shoreline node IDs, beach/cliff/cape/spit flags, erosion/deposition, exposure, shoreline advance, and coastline statistics.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_coast_test.gd
```

The fixture checks one shoreline’s cliff classification plus sheltered beaches with a deterministic high-angle longshore spit and lagoon record.

## Dependencies

- A complete `gx`/`gy` water/land lattice with elevation, slope, wind, optional sediment, stride, scale factor, and sea level.

## Performance impact

Shoreline extraction and instability are linear in region cells and shoreline nodes. Each component uses an iterative flood fill.

## Out of scope

- Shoreline mesh changes, hydrodynamics, sediment transport over time, and final biome/render assignment.
