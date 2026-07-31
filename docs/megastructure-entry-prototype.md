# Megastructure entry prototype

Milestone 2 makes the fixed deterministic spine descriptor playable in the procedural expedition. M3 now publishes pure intersections into chunk descriptors; the prototype remains the first-slice scene realization until M4 moves construction into normal streaming categories.

`main.gd` derives megacell zero from the run seed before `WorldStreamer.configure`, places the player at its approach, then compiles a `MegastructurePrototype` on the main thread. The prototype is translated with the existing `WorldStreamer.origin_rebased` signal, so its engine-local masses stay aligned with the canonical descriptor during a floating-origin rebase.

The prototype compiles only coarse first-slice masses:

- grounded enclosed approach and baseline route collision surface;
- threshold lintel and compressed paired walls;
- opening-sector walls;
- elevated deck and repeated distant supports;
- deterministic `SignalSpire` signature landmark and grapple anchor.

The entry uses the descriptor's revealed direction for the initial player view. Walking normally passes from the enclosed approach through the threshold/compression sequence to the foreground route beneath the long deck. The descriptor-owned interior floor replaces ordinary terrain in every touched macro chunk and normal biome features are suppressed there. The deck/support rhythm is a deliberate distant continuation cue; it is not streamed megastructure content yet.

Press `F4` during an expedition to toggle non-authoritative debug geometry for the descriptor's structure/sector bounds, entry threshold, route lines, reveal focus, and M3 boundary ports sampled along declared routes. Green/yellow crosses are canonical structural/traversal owners; purple/coral crosses are their neighboring copies. The runtime mass remains visible with the overlay disabled. `F2`, `F3`, `L`, photo controls, pixel filtering, and normal streaming arbitration are unchanged.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_prototype_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_megastructure_entry_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd
./script/build_and_run.sh
```

The headless tests verify coarse masses, debug visibility, entry spawn, and prototype rebase translation. Manual validation on 2026-07-31 started an expedition through `build_and_run.sh`, traversed the route through the threshold/compressed walls, observed the repeated deck/support reveal, and toggled `F4`.

## Deferred

M4 must move this prototype's far/shell/collision/detail work into the existing attachment categories and preserve normal-frame mutual deferral. M5 owns analytic route envelopes and survival-effect runtime behavior.
