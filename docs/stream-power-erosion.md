# Stream-power erosion

`WorldStreamPower.relax(region, options)` ports Thoth’s fluvial stream-power incision, grade/sea-level constraints, plate-based or fixed uplift, erodibility scaling, and downstream sediment capacity/deposition routing. It writes elevation, stream-power diagnostics, sediment fields, and then synchronizes the bedrock/regolith invariant.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_stream_power_test.gd
```

The fixture checks in-place incision, diagnostic/sediment output, regolith synchronization, and lithology-erodibility scaling.

## Dependencies

- Priority-flood/D8 visit order, flow, downstream links, and distances.
- Soil-production sync and optional lithology erodibility/tectonic uplift fields.

## Performance impact

Relaxation is `O(iterations × cells)` plus two linear diagnostic/sediment passes. It mutates caller-owned cells and allocates only result dictionaries.

## Out of scope

- Debris-flow incision/deposition, hillslope diffusion, isostatic rebound, glacial processes, and terrain integration.
