# Temporary shelter construction

The `build_shelter` action spends three wood, one scrap, and two fiber through the existing stabilized-terrain gate. A temporary shelter is attached to its active streamed chunk and provides radial cover: nearby cover reduces precipitation and wind passed to `SurvivalState`, lowering wetness and exposure. Chunk eviction removes it.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_shelter_test.gd
```

## Dependencies

- scavenged-material inventory
- traversal material-placement gate
- `WorldStreamer`
- weather exposure simulation

## Performance

Shelter construction is input-triggered; active shelter cover checks scan only temporary shelters retained in active chunks.

## Out of scope

Shelter collision, sleeping, persistence, structural damage, crafting alternatives, and visual weather occlusion.
