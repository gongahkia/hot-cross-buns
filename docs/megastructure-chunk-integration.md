# Megastructure chunk integration

M3 makes megastructure data part of `WorldGenerator.chunk_descriptor` for local procedural expeditions. The field is omitted outside a macro intersection; otherwise it is:

```text
megastructure = {
  schema: "megastructure-chunk/v1",
  intersections: [megastructure-intersection/v1, ...]
}
```

`WorldGenerator` identifies the containing megacell and its eight planar neighbors, caches their immutable macro descriptors per generator instance, then retains only non-empty pure intersections. Results are sorted by structure id. The worker receives no scene objects and `WorldChunkScheduler` returns this descriptor unchanged.

## Version and persistence

This is a deliberate major world-output transition: `WorldGenerationIdentity.GENERATOR_SCHEMA_VERSION` is `2.0.0`. Current strict run records, exports, and megastructure hashes use that value. v1 strict run records are intentionally rejected as `generator_schema_version_mismatch`; no migration, regeneration, or compatibility reader is supplied.

## Enclosed generation

The v2 descriptor defines an interior floor at y=24. Every streamed chunk with a macro intersection uses that floor for both its render mesh and collision heightmap, and suppresses ordinary terrain/city/wildlife/resource feature generation. The M2 spine root spans the route with continuous walls and an overhead transit deck, so the first generated area is inside the megastructure rather than a raised walkway above unrelated terrain.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_streaming_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_collision_seam_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_record_schema_compatibility_test.gd
```

The tests cover direct descriptor output, scheduler output, v1 rejection, interior floor mesh/collision, no ordinary interior features, and the structural floor/deck relationship.
