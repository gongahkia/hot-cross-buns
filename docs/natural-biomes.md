# Natural biome rules and transitions

`WorldBiomes` ports Thoth’s terrestrial table, water/reef/geology precedence, elevation and climate overrides, plus treeline, riparian, seasonal fire, dune, coastal, forest, exotic, and secondary-biome transitions.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_biomes_test.gd
```

The fixture covers terrestrial and feature precedence plus treeline and riparian transitions.

## Dependencies

- Climate, terrain, water, reef, volcanic, periglacial, river, aeolian, coastal, lithology, and optional exotic fields.

## Performance impact

Constant time per cell.

## Out of scope

- Rendering, ecology simulation, and biome mesh generation.
