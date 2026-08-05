# Biome and region preload corridors

`WorldPreloadCorridor` targets a three-chunk-wide, eight-chunk-long data corridor 3–10 chunks ahead of travel. `WorldStreamer` schedules up to 24 descriptors at lower priority than active chunks, stores completed descriptors in `WorldChunkCache`, and builds no nodes until a target becomes active.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_preload_corridor_test.gd
```

## Dependencies

- Player travel/camera heading, `WorldChunkScheduler`, and `WorldChunkCache`.

## Performance impact

The corridor caps speculative work at 24 data-only descriptors. Active chunks retain queue priority; initial active-chunk construction does not wait for corridor work.

## Out of scope

- Cross-session cache persistence, terrain-node preconstruction, and path prediction beyond the current heading.
