# Overgrown-suburb scavenging ecology

`WorldSuburbResources` derives deterministic food, water, and scrap pickups from yard, home, and collapse records. `WorldStreamer` renders these pickups and suppresses the overgrown-suburb generic pickup.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_suburb_resources_test.gd
```

## Dependencies

- Overgrown-suburb parcel/home and traversal descriptors plus `WorldRng`.

## Performance impact

Each active overgrown-suburb chunk adds three pickup areas.

## Out of scope

- Resource respawn, crafting, inventory capacity, consumption balance, and vegetation harvesting.
