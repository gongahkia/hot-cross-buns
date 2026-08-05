# Chunk-memory telemetry

`WorldChunkMemoryTelemetry` reports active/far chunk counts, cached descriptor count, generated render vertices, collision height samples, and their exact minimum payload bytes from the constructed position/UV and height arrays. It also reports Godot’s engine-wide static-memory monitor.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_chunk_memory_telemetry_test.gd
```

## Dependencies

- Chunk LOD metadata, far-impostor grid size, cache count, and Godot `Performance.MEMORY_STATIC`.

## Performance impact

Snapshots traverse the active 25-chunk set and allocate one small dictionary. No history is retained.

## Out of scope

- Per-resource/node/driver allocations, descriptor dictionary byte size, GPU residency, and a memory-budget compliance claim.
