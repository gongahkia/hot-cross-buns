# Hunger and food acquisition/consumption

Food pickups add to `SurvivalState.materials.food`; hunger declines during procedural expeditions. `consume_food()` restores `34` hunger when food exists, and the configurable `consume_food` action defaults to `1` during an active run.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_food_test.gd
```

## Dependencies

- `ResourcePickup`, `SurvivalState`, main-run input processing, and Settings action bindings.

## Performance impact

- One input check per active run frame; no generation impact.

## Out of scope

- Cooking, food spoilage, buffs, hunger-specific movement penalties, and UI rebinding presentation.
