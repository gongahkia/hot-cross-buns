# Ocean age and depth

`WorldOcean.gdh1_depth_meters(age_my)` ports the GDH1-style ocean cooling curve used by Thoth:

- before 20 Myr: `2600 + 365 × sqrt(age)` meters;
- from 20 Myr: `5651 - 2473 × exp(-age / 36)` meters.

`sample(plate, sea_level, z_scale, max_age_my)` clamps normalized plate age to `[0, 1]`, converts it to Myr, then returns depth and normalized elevation. The defaults use a 180 Myr maximum ocean age and a 10,000-meter vertical scale.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_ocean_test.gd
```

The fixture checks negative age clamping, both curve branches, the 20 Myr breakpoint, old ocean depth, a source-derived plate sample, normalized-age clamping, and vertical scaling. It exits non-zero on a mismatch.

## Dependencies

- Plate normalized age from the deterministic plate classifier.
- Caller-owned sea level, maximum ocean age, and world vertical scale.

## Performance impact

Sampling is constant-time scalar math with one square root or exponential. It has no cache, allocation beyond its small result dictionary, or renderer dependency.

## Out of scope

- Plate crust gating, continental elevation, isostasy, sea-level time series, and terrain integration.
- Bathymetric meshing, shelf classification, and ocean currents.
