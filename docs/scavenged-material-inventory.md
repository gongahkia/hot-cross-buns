# Scavenged-material inventory

`SurvivalState` maintains wood, scrap, and fiber as explicit scavenged materials. Pickups must be accepted by that inventory before they are recorded in `RunData`. The HUD shows `M wood/scrap/fiber`; atomic validation and spending APIs support later shelter, placement, and crafting systems.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_material_inventory_test.gd
```

## Dependencies

- `ResourcePickup`
- `SurvivalState`
- `RunData`
- expedition HUD

## Performance

Inventory operations iterate only the requested cost keys; no polling, nodes, or generation work is added.

## Out of scope

Inventory capacity, dropping, crafting recipes, material persistence, and respawns.
