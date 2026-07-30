# Industrial-ruin salvage resource ecology

`WorldIndustrialResources` derives deterministic factory scrap, tank water, and conveyor scrap pickups from industrial structures. `WorldStreamer` renders these normal resource pickups and suppresses the industrial family’s generic pickup.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_industrial_resources_test.gd
```

## Dependencies

- Industrial layout/structure descriptors and `WorldRng`.

## Performance impact

Each active industrial-ruin chunk adds three pickup areas.

## Out of scope

- Resource respawn, inventory capacity, crafting recipes, purification, and hazard interaction.
