# Compatibility fixtures

Schema-one fixtures live in `fixtures/compatibility/v1/`. The current corpus
contains 20 public addons. Every fixture pins a public HTTPS Git source to a
full commit and records its explicit layout, complete expected installed file
paths, canonical package-tree SHA-256, and Godot version requirement.

Fixtures are parsed in ordinary tests. Source verification is opt-in and uses
only manually checked-out local repositories:

```text
WUKONG_COMPATIBILITY_SOURCES=/absolute/path cargo test -p wukong-core --test compatibility_fixture -- --ignored
```

The directory must contain one source checkout per fixture id, at the exact
recorded commit. The verifier does not fetch a source and does not execute
`headless_validation`. It checks each checkout revision, verifies the prepared
tree, materialises it once into a fresh project, reuses that prepared tree for
a second fresh project, then checks a no-op repeat synchronisation. See
[ADR 0011](adr/0011-compatibility-fixture-schema.md).

Contributor selection, review, and update rules are in the
[fixture guide](fixture-guide.md).

## W084 validation record

The recorded layouts are explicit because addon repositories do not have one
common root layout. On 2026-07-29, each pinned source passed the opt-in
fixture verification above. The headless column records a separate source
project smoke check in a disposable copy using Godot
`4.7.1.stable.official.a13da4feb`, in recovery mode. It does not activate
plugins or execute package scripts.

| Fixture | Target layout override | Source-project headless result |
| --- | --- | --- |
| `animated-shape-2d` | `addons/goutte.animated_shape_2d` | not feasible: no source `project.godot` |
| `button-feedback` | `addons/button_feedback` | passed |
| `finite-state-machine` | `addons/finite_state_machine` | passed |
| `godot-4-aseprite-importers` | `addons/nklbdev.aseprite_importers` | not feasible: no source `project.godot` |
| `godot-4-importality` | `addons/nklbdev.importality` | not feasible: no source `project.godot` |
| `godot-debug-draw-3d` | `addons/debug_draw_3d` | passed: `dd3d_web_build` project |
| `godot-game-settings` | `addons/ggs` | passed |
| `godot-input-helper` | `addons/input_helper` | passed |
| `godot-sound-manager` | `addons/sound_manager` | passed |
| `input-controller` | `addons/input_controller` | passed |
| `inventory-manager` | `addons/rubonnek.inventory_manager` | passed |
| `quest-manager` | `addons/rubonnek.quest_manager` | passed |
| `quest-system` | `addons/quest_system` | passed |
| `scene-tools` | `addons/scene_tools` | not feasible: no source `project.godot` |
| `simple-gui-transitions` | `addons/simple-gui-transitions` | passed |
| `slider-gamepad` | `addons/slidergamepad` | passed |
| `terrain-autotiler` | `addons/terrain_autotiler` | not feasible: no source `project.godot` |
| `threaded-resource-save-load` | `addons/ThreadedResourceSaveLoadPlugin` | passed |
| `vision-cone` | `addons/vision_cone_2d` | passed |
| `wigglebone` | `addons/wigglebone` | passed |
