# Glacial ice, abrasion, and rebound fields

`WorldGlaciers.glaciate` ports the local shallow-ice accumulation, two-face transport, velocity/slope abrasion and plucking, plus persisted `ice_state`. It writes ice thickness, glaciation, glacial erosion/delta, and synchronizes bedrock/regolith after cutting.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_glaciers_test.gd
```

The fixture checks cold highland accumulation and generated ice/erosion/state fields.

## Dependencies

- Rectangular `gx:gy` cell grids with temperature, elevation, and regolith/bedrock fields.

## Performance impact

The shallow-ice solve is linear per SIA iteration with east/south face checks.

## Out of scope

- Lithospheric isostatic rebound smoothing, climate generation, and cross-region ice continuity.
