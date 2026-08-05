# Urban traversal-affordance validation

`world_urban_traversal_affordance_test.gd` validates the versioned urban fixtures’ traversable ledges/roofs, flood bridges/routes, industrial catwalk/access routes, and suburb entries/canopies/roots/collapses against their descriptor geometry.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_urban_traversal_affordance_test.gd
```

## Dependencies

- Urban-region fixtures and all urban descriptor pipelines.

## Performance impact

- Test-only descriptor generation; no runtime impact.

## Out of scope

- Player-controller simulation, full graph reachability, combat encounters, and visual screenshots.
