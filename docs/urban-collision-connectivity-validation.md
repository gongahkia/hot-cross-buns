# Urban collision and connectivity validation

`world_urban_collision_connectivity_test.gd` loads the expedition scene, builds every versioned urban fixture chunk, validates expected collision bodies/shapes, and verifies each family’s deterministic connector records.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_collision_connectivity_test.gd
```

## Dependencies

- Main scene/autoloads, urban-region fixtures, `WorldStreamer`, and all urban descriptor pipelines.

## Performance impact

- Test-only scene construction; no runtime impact.

## Out of scope

- Full navigation solving, player movement simulation across every connector, cross-chunk terrain seams, and screenshot validation.
