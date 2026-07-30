# Field crafting recipes

The field filter consumes one scrap, one fiber, and one dirty-water unit to produce one water unit. Recipes are immutable data and crafting updates the inventory atomically; `craft_filter` defaults to `8`.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/field_crafting_test.gd
```

## Dependencies

- `SurvivalState` inventory
- Settings input bindings

## Performance

Crafting runs only on input and iterates the recipe’s bounded inputs/outputs.

## Out of scope

Recipe discovery, stations, durability, multiple outputs, and crafting UI.
