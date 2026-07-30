# Hillslope and debris-flow erosion

`WorldHillslope.diffuse` ports nonlinear regolith transport across east/south faces, including lithology-sensitive critical slope and stream-power-slope recomputation. `WorldDebrisFlow.apply` ports concentration-triggered debris incision, equilibrium deposition, and downstream sediment transfer.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_hillslope_test.gd
```

The fixture checks downhill regolith transfer and concentration-triggered debris routing.

## Dependencies

- Rectangular `gx:gy` cells, regolith/bedrock fields, and D8 downstream links with flow.

## Performance impact

Hillslope diffusion is linear per iteration; debris routing is linear in visit order. Both mutate caller-owned cells.

## Out of scope

- Stream-power fluvial incision, isostatic rebound, glaciation, terrain integration, and cross-region sediment exchange.
