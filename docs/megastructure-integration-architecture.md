# Megastructure integration architecture

Status: Milestone 0 audit, 2026-07-31. This records the inspected boundaries and selected conventions; it changes no runtime behavior or world appearance.

## Baseline validation

All required commands exited `0` before this audit's documentation changes:

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_streaming_runtime_budget_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_traversal_soak_test.gd
```

The first two print only the Godot banner. The soak also exits `0`; no test assertion failed. The known DummyShader RID diagnostic did not occur in this run.

## Final validation

The same three commands exited `0` again after all M0 documentation changes. The final smoke run emitted `1 RID allocations of type 'N13RendererDummy15MaterialStorage11DummyShaderE' were leaked at exit`; it is the documented non-failing diagnostic and all smoke assertions passed. The runtime-budget and traversal-soak commands printed only the Godot banner and completed without assertion failures.

## Existing descriptor and streaming boundaries

`WorldGenerator` in `scripts/world_generator.gd` owns deterministic terrain/region sampling and returns a fresh data-only `Dictionary` from `chunk_descriptor(chunk_x, chunk_z)`. M3 now adds non-empty local `megastructure-chunk/v1` intersections there.

`WorldChunkScheduler` in `scripts/world_chunk_scheduler.gd` creates a generator on its sole worker and returns only the descriptor, request token, and canonical chunk key. `WorldStreamer._attach_completed` validates the token against `pending_chunks`, then owns cache admission and the transition to `queued_active_chunks`. Worker code must continue to produce no nodes, meshes, collision shapes, or scene mutations.

`WorldStreamer` in `scripts/world_streamer.gd` is the only attachment owner:

| Existing owner | M3/M4 integration point | Constraint |
| --- | --- | --- |
| `WorldGenerator.chunk_descriptor` | bounded pure `megastructure` intersection field | coordinate-derived; no loaded-neighbor or cache dependency |
| `WorldChunkScheduler._generate` | carries the enlarged pure descriptor unchanged | one worker; cancellation/token handoff remains authoritative |
| `WorldStreamer._build_chunk` | later attach active shell/collision only after its existing category is admitted | canonical descriptor is converted to local transforms here |
| `WorldStreamer._update_far_terrain` | later attach macro silhouettes | far remains collision-free |
| `WorldStreamer._build_pending_features` | later attach traversal/detail nodes | detail remains chunk-owned and unloads with its root |
| `WorldStreamer._update_collision_lods` + `WorldCollisionHandoff` | later replace terrain/structure collision | replacement precedes retirement through the next physics frame |
| `WorldOrigin` | remains the canonical-world to engine-local conversion boundary | rebases cannot change descriptor IDs, hashes, ports, or cache keys |
| `scripts/main.gd` + `StreamingProfileRecorder` | M4 diagnostics/profile phases and later debug draw wiring | retain F3/L behavior and `streaming-profile/v1` schema unless versioned |

`main.gd` currently spawns the procedural expedition at canonical zero after `WorldStreamer.configure`; M2 is the earliest valid place to change entry placement. Creative levels use `LevelBuilder`, not `WorldStreamer`; their entry-contract integration is separate and must not be folded into the procedural descriptor path.

## Normal-frame queue arbitration

`WorldStreamer.refresh(false)` is the queue policy to preserve. First it accepts completed data-only worker results and handles a possible floating-origin rebase. It then uses this order in both unchanged-center and changed-center normal frames:

1. `_build_pending_chunks(false)` builds at most `ACTIVE_CHUNKS_PER_FRAME == 1` active chunk.
2. `_update_collision_lods(false, active_built == 0)` may build at most `COLLISION_LODS_PER_FRAME == 1` replacement only when no active chunk was built.
3. `background_builds_allowed` is true only when neither an active chunk nor a collision LOD was built.
4. `_update_far_terrain(false, background_builds_allowed)` may build at most `FAR_CHUNKS_PER_FRAME == 2` far chunks.
5. `_build_pending_features(false, background_builds_allowed)` may build at most `FEATURE_CHUNKS_PER_FRAME == 1` feature chunk within `FEATURE_BUILD_RADIUS == 1.5`.

Therefore active construction excludes collision, far, and feature construction for that frame; collision construction excludes far and feature construction. The current code can construct far terrain and feature detail in the same already-admitted background frame. `refresh(true)` is controlled synchronous initialization and intentionally bypasses normal-frame caps; it is not a new normal-frame queue category.

M4 must add no independent megastructure queue. Far/shell/collision/detail work must enter the matching existing category and inherit this gate. Collision replacements must keep `WorldCollisionHandoff.install` followed by `retire_after_physics_frame` exactly as the terrain path does.

## Deterministic identity, hash, and RNG choices

Existing stable primitives are:

- `WorldRng.thoth_hash(seed, a, b, c, d)`, `unit_at`, and `thoth_signed` for stable signed-32-bit coordinate tuples;
- `WorldRng.new(seed)` for an explicitly owned deterministic LCG stream;
- `RunRecordSchema.canonical_hash`, which uses sorted-key canonical JSON and `HashingContext.HASH_SHA256` for run records only.

M1 should derive each named megastructure stage seed from `WorldRng.thoth_hash` with reviewed, fixed integer salts, then create a local `WorldRng` only for that stage. It must not use global RNG state, runtime `hash()`, object IDs, frame counters, or dictionary iteration order.

M1 should add an owner-local `WorldMegastructureHash` using the same sorted-key canonical encoding rules and `HashingContext.HASH_SHA256`; `RunRecordSchema` remains private to run-record validation. The payload must include megastructure descriptor schema version, world seed, `WorldGenerator.GENERATOR_SCHEMA_VERSION`, canonical megacell coordinate, archetype version, field names, scalar units, and ordered arrays. Debug metadata, timings, and error text are excluded.

## Test and debug conventions

Tests are flat `scripts/*_test.gd` files. They generally `extend SceneTree`, preload the owning module, collect a `failed` flag, call `quit(1 if failed else 0)` from `_initialize`, and run through direct headless Godot commands. Versioned fixture documents live under `levels/*.vN.json` when exact external data is needed. M1's first pure contract belongs in `scripts/world_megastructure_generator.gd` with `scripts/world_megastructure_generator_test.gd`; no empty test entry point was added because current tests assert real contracts rather than existence.

`F2`, `F3`, and `L` are owned by creative mode, diagnostics, and streaming profiling; `P`, `F11`, and `F12` are photo controls. `KEY_F4` is unused by project scripts and is the reserved later megastructure debug-toggle candidate. It must be handled as a non-authoritative physical key in `main.gd::_input` only after a real debug overlay exists; it does not belong in `Settings.ACTIONS`.

## Chosen file layout

Use the existing flat `scripts/world_*.gd` convention rather than creating the proposed directory prematurely:

```text
scripts/world_megastructure_generator.gd       # M1 pure macro descriptor
scripts/world_megastructure_hash.gd            # M1 canonical descriptor hashing
scripts/world_megastructure_intersection.gd    # M3 chunk-local pure compilation
scripts/world_megastructure_route_validator.gd # M5 conservative route envelopes
scripts/world_megastructure_generator_test.gd  # M1 deterministic contract
scripts/world_megastructure_boundary_test.gd   # M3 boundary contract
scripts/world_megastructure_route_test.gd      # M5 route preservation
```

This keeps each class beside its headless test and aligns with the repository's `WorldGenerator`/`WorldStreamer` module naming. Do not create the files until their first tested responsibility is implemented.

## Owner decisions

No owner decision blocked Milestone 1 because it added unused pure descriptor data only. The owner approved M3's `2.0.0` generator-identity transition with no historical strict-run compatibility; M3 therefore rejects v1 strict world identity rather than migrating or regenerating it. Before authored-level integration, the owner must approve the `LevelDocument` entry/exit-port schema and migration policy.
