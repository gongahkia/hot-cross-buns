# Aeolian dune generation

`WorldAeolian.apply` ports deterministic sand-slab initialization, wind-regime selection, transport, shadowing, repose, and dune morphology fields.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_aeolian_test.gd
```

The fixture checks deterministic desert slab generation and morphology fields.

## Dependencies

- Desert/water/river/lake terrain fields and optional wind vectors.

## Performance impact

Linear setup plus configured transport iterations; repose is bounded to 64 operations.

## Out of scope

- Climate wind generation, sediment supply, cross-region transport, and rendering.
