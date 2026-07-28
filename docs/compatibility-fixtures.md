# Compatibility fixtures

Schema-one fixtures live in `fixtures/compatibility/v1/`. The current corpus
contains 50 public addons. Every fixture pins a public HTTPS Git source to a
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
[fixture guide](fixture-guide.md). The separate
[external-testing ledger](external-testing.md) distinguishes fixture evidence
from feedback supplied by external testers. See [compatibility expansion
status](compatibility-expansion.md) for coverage that is not yet public-corpus
evidence.

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

## W151 multi-addon validation record

On 2026-07-29, four addons from the same public MIT-licensed GDQuest source at
commit `74cb5e8c1eab4fa442b37ba39c69fb9d0b8f5162` passed opt-in source
verification: prepared-tree verification, cold materialisation, warm reuse,
and no-op sync. The verifier did not execute the repository's documented
`gd-plug` scripts or Godot. Headless validation is not recorded because a Godot
executable is unavailable on this machine.

| Fixture | Source subdirectory | Target path |
| --- | --- | --- |
| `gdquest-3d-math-visualizer` | `addons/gdquest_3d_math_visualizer` | `addons/gdquest_3d_math_visualizer` |
| `gdquest-colorpicker-presets` | `addons/gdquest_colorpicker_presets` | `addons/gdquest_colorpicker_presets` |
| `gdquest-prototype-material` | `addons/gdquest_prototype_material` | `addons/gdquest_prototype_material` |
| `gdquest-sparkly-bag` | `addons/gdquest_sparkly_bag` | `addons/gdquest_sparkly_bag` |

## W151 native-extension validation record

On 2026-07-29, MIT-licensed QuarkPhysics source at commit
`29ca59d2536662352dc9c07c6e727c77014fdb3f` passed opt-in source verification:
prepared-tree verification, cold materialisation, warm reuse, and no-op sync.
Its checked-out addon contains a `.gdextension` descriptor with a 4.1 minimum.
It does not contain the descriptor's native libraries, so this is not runtime,
ABI, architecture, or platform-binary compatibility evidence. No Godot or
package script was executed.

| Fixture | Source subdirectory | Target path | Descriptor |
| --- | --- | --- | --- |
| `quarkphysics` | `project/addons/quarkphysics` | `addons/quarkphysics` | `bin/quarkphysics.gdextension` |

## W151 fifty-fixture validation record

On 2026-07-29, 25 additional addon layouts from 22 public MIT-licensed
sources passed opt-in source verification: prepared-tree verification, cold
materialisation, warm reuse, and no-op sync. The expansion includes three
explicit BBCodeEdit layouts and two YATI language layouts. It verifies only
source-tree materialisation; neither Godot nor package scripts ran.

| Source | Layout count |
| --- | ---: |
| `BBCodeEdit` | 3 |
| `YATI` | 2 |
| 20 other public MIT sources | 20 |
