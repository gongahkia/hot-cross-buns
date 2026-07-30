# Thoth OpenSimplex sampling port

`scripts/world_noise.gd` ports the historical 2D OpenSimplex sampler and exposes deterministic composition helpers:

- `value(seed, x, z, salt)` returns clamped OpenSimplex noise in `[0, 1]`.
- `fbm(...)` layers seeded octaves with caller-supplied frequency, lacunarity, gain, and salt.
- `ridge(...)` folds fBm around its midpoint into `[0, 1]`.
- `warp(...)` uses two independent three-octave fBm fields and returns a warped `Vector2`.

The implementation uses the Thoth-compatible `WorldRng.thoth_hash` port for gradient selection. Existing `WorldRng` value-noise helpers and terrain callers are unchanged.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_noise_test.gd
```

The fixture checks LuaJIT-derived value/fBm/ridge/warp vectors, output bounds, and repeatability. A tolerance of `1e-6` permits normal floating-point differences while retaining a fixed deterministic fixture.

## Dependencies

- `WorldRng.thoth_hash` for the legacy 32-bit gradient index stream.
- Godot `Vector2`, `floori`, and scalar math functions only; no editor, renderer, or third-party dependency.

## Performance impact

Each value sample evaluates up to three gradient contributions. fBm scales that cost by its octave count; `warp` performs two three-octave fBm evaluations. Sample once per coarse field/chunk and interpolate or cache downstream results; do not run warp per rendered pixel or physics tick.

## Out of scope

- Replacing existing value-noise terrain output or retuning region thresholds.
- 3D noise, curl fields, erosion, terrain meshing, or GPU noise.
- Parameter validation for non-finite values or gains/lacunarity outside the caller's deterministic generation contract.
