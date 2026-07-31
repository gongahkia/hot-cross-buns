# Codex Handoff: Megastructure Integration

Use this file to orient a coding agent working inside the existing `a-slow-walk` repository.

## Project summary

`a-slow-walk` is a Godot 4.7 first-person survival and traversal game.

Entry scene: `scenes/main.tscn`

Runtime target:

- deterministic infinite reclaimed-Earth expedition world;
- separate internal creative editor for authored static levels;
- GDScript;
- GL Compatibility renderer;
- 1280×720 base viewport with canvas stretch;
- macOS development;
- build/run: `./script/build_and_run.sh`;
- release export: `./script/export_release.sh`.

Core traversal includes movement, sprint, jump/double jump, dash, slide, wall-running, grapple/tether, glide, slam, and reset.

Core survival includes hunger, thirst, warmth, health, fatigue, wetness, exposure, food, water collection and purification, field crafting, temporary shelter/platform construction, and extraction/failure records.

The world generator is coordinate- and seed-derived. The same seed and generation version must produce the same result regardless of chunk load order.

Current spatial constants:

- chunk size: 64;
- region size: 512;
- active window: 5×5 chunks;
- `ACTIVE_RADIUS = 2`.

Region families:

- reclaimed city;
- flooded city;
- industrial ruin;
- overgrown suburb;
- wilderness.

Important files:

- `scripts/main.gd`
- `scripts/player.gd`
- `scripts/settings.gd`
- `scripts/survival_state.gd`
- `scripts/world_generator.gd`
- `scripts/world_streamer.gd`
- `scripts/streaming_profile_recorder.gd`
- `docs/design-pillars.md`
- `docs/streaming-hitch-telemetry.md`
- `docs/expedition-controls-survival-photo-mode.md`

The existing streamer has worker-generated chunk descriptors and main-thread visual/collision attachment, an LRU descriptor cache, preload corridor, floating-origin rebasing, far-terrain impostors, render/collision LOD, and collision handoff.

A recent critical fix made active-chunk construction, collision-LOD construction, and far/detail construction mutually deferred in normal frames. Preserve that behavior. Do not add a new queue that bypasses it.

Normal per-frame caps currently include:

- 1 active chunk;
- 1 collision LOD;
- 2 far chunks;
- 1 feature chunk.

Profiling:

- F3 shows runtime diagnostics;
- L toggles procedural-expedition streaming profiling;
- second L press exports JSON under `user://profiles`;
- hitches at or above 22 ms retain phase timings.

Existing profile files were deliberately deleted. The last recorded traversal before deletion ran for 39.85 seconds with zero streaming hitches.

## New direction

Integrate civilization-scale megastructures into the existing deterministic world.

The player should spend most of the game in local, readable traversal spaces. At selected points, the world should open into views that reveal enormous structures continuing far beyond the current sector.

Every authored level and every procedural expedition start should begin by entering a megastructure:

1. orient toward or within its exterior mass;
2. cross a playable spatial threshold;
3. enter a compressed local route;
4. reach an early internal reveal demonstrating the larger scale.

The first archetype is a ruined transcontinental infrastructure spine crossing existing region families.

The full product and technical requirements are in:

- `docs/megastructure-design-spec.md`
- `docs/megastructure-technical-design.md`
- `TODO_MEGASTRUCTURE.md`

## Agent operating rules

1. Read the three files above and all existing authoritative project docs before editing code.
2. Inspect current implementation rather than assuming the handoff summary is exact.
3. Run baseline validation before changing code.
4. Work on one milestone or smaller coherent unit at a time.
5. Do not broadly refactor unrelated systems.
6. Do not change player movement feel unless the current milestone explicitly requires it.
7. Do not remove pixelation to improve readability.
8. Do not alter deterministic identity inputs without documenting and versioning the change.
9. Do not use global mutable RNG state for generation.
10. Do not depend on neighbor load state or task completion order.
11. Keep worker generation pure-data and main-thread attachment explicit.
12. Preserve collision handoff.
13. Preserve normal-frame heavyweight mutual deferral.
14. Add profiling phases before accepting performance assumptions.
15. Update `TODO_MEGASTRUCTURE.md` as tasks complete.
16. Make one coherent git commit per completed task.
17. Stop at milestone exit criteria. Do not continue into later milestones automatically.
18. Ask the owner only when a genuinely blocking product or architecture decision remains after repository inspection.
19. Treat the known DummyShader RID leak diagnostic as non-failing only if all current smoke assertions pass.
20. Leave the worktree clean.

## Baseline validation

Run:

```bash
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd

/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_streaming_runtime_budget_test.gd

/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_traversal_soak_test.gd
```

Also run repository formatting, linting, or other checks that already exist.

## Recommended first agent assignment

Do only Milestone 0 from `TODO_MEGASTRUCTURE.md`.

Expected output:

- baseline results;
- exact generation and streaming integration points;
- documented queue arbitration;
- selected stable hash/RNG approach;
- approved invariants merged into `docs/design-pillars.md`;
- minimal scaffolding only if consistent with repository conventions;
- all baseline tests still passing;
- one or more focused commits;
- a clean worktree;
- a concise report of remaining owner decisions before Milestone 1.

Do not implement visible megastructure geometry during Milestone 0.
