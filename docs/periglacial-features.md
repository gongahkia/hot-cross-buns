# Periglacial features

`WorldPeriglacial.apply` ports cold-cell pingo/palsa mounds, polygonal ground, and solifluction ridges. It uses Thoth hash choices and mutates elevation/bedrock/slope plus the integer `periglacial_feature` field.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_periglacial_test.gd
```

The fixture checks deterministic pingo, palsa, and solifluction paths.

## Dependencies

- Temperature, water/glacier state, terrain/slope, and optional biome/moisture fields.

## Performance impact

Linear cold-cell scan with 3×3 work only for selected mounds.

## Out of scope

- Climate generation, glacial dynamics, erosion feedback, rendering, and persistence.
