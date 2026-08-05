# Temporary traversal construction

The `build_platform` action spends two wood, two scrap, and one fiber through the stabilized-terrain gate. It creates a collision-bearing temporary platform two metres ahead of the player and attaches it to the active streamed chunk, preserving origin-rebase alignment and removing it on chunk eviction.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/traversal_material_placement_test.gd
```

## Dependencies

- scavenged-material inventory
- traversal material-placement gate
- `WorldStreamer` chunk roots and collision

## Performance

Construction is input-triggered; each platform adds one static body, mesh, and box collision to its active chunk.

## Out of scope

Bridges across water, persistence, repair, dismantling, route planning, and crafting alternatives.
