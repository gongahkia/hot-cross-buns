# Expedition controls, survival, and photo mode

These are the default bindings from `Settings`. Action bindings can be changed in Settings; photo-mode keys are fixed physical keys while photo mode is active.

## Traversal and expedition

| Action | Keyboard | Gamepad | Behavior |
| --- | --- | --- | --- |
| Move / look | `W` `A` `S` `D` / mouse | left stick / — | Move and look while the expedition has mouse capture. |
| Jump | `Space` | A | Ground, coyote-time, wall, and double jump as available. While grappling, it releases the tether. |
| Dash | `Shift` | right shoulder | One airborne/ground dash when available. |
| Sprint | `Ctrl` | left stick click | Hold to sprint on ground; press while airborne to request a sprint dash. |
| Slide | `C` | B | Hold by default; Settings can make it a toggle. Requires ground speed. |
| Grapple | `E` | X | Hold by default; Settings can make it a toggle. |
| Glide | `F` | D-pad up | Hold while falling. |
| Ground slam | `Q` | left shoulder | Airborne only. |
| Reset | `R` | Y | Reset the current run/player. |
| Extract | `X` | — | In a procedural expedition, opens confirmation; extraction banks the resolved record and returns to title. |
| Pause | `Esc` | Start | Pause/resume. |
| Diagnostics | `F3` | — | Toggle the debug panel. |

## Survival and field actions

`SurvivalState` starts each expedition with hunger, thirst, warmth, health, fatigue, wetness, and exposure at/within a 0–100 range plus food/water/material inventory. Hunger and thirst drain continuously; temperature, wind, rain, wetness, and precipitation determine exposure and warmth. At zero hunger, thirst, or warmth, health drains; zero health resolves the run as a failure. Falls can apply direct injury.

Movement raises fatigue; low survival values and fatigue lower traversal speed, but the current policy keeps an alive player at no less than a `0.65` multiplier. Resting while hunger, thirst, and warmth are each at least 60 and exposure is at most 0.5 reduces injury and restores linked health. Shelter reduces incoming wind and precipitation, which lowers wetness/exposure.

| Action | Key | Default gamepad | Requirement/result |
| --- | --- | --- | --- |
| Eat | `1` | D-pad left | Consume one food; restores 34 hunger. |
| Source water | `2` | — | Collect water from eligible water/freshwater-adjacent terrain; contaminated sources provide dirty water. |
| Purify water | `3` | — | Convert one dirty water to one water. |
| Drink | `4` | D-pad right | Consume one water; restores 42 thirst. |
| Place route marker | `5` | — | Costs one wood and one fiber; requires stable, dry, grounded placement. |
| Build shelter | `6` | — | Costs three wood, one scrap, two fiber; temporary cover is removed when its chunk unloads. |
| Build platform | `7` | — | Costs two wood, two scrap, one fiber; temporary collision platform is removed when its chunk unloads. |
| Craft field filter | `8` | — | Consumes one scrap, one fiber, and one dirty water to make one water. |

See [hunger-food.md](hunger-food.md), [thirst-water.md](thirst-water.md), [survival-recovery-movement.md](survival-recovery-movement.md), and [temporary-shelter-construction.md](temporary-shelter-construction.md) for subsystem detail.

## Photo mode

Press `P` to enter/exit. Entering swaps to a temporary free camera, disables player movement, and hides the HUD; it does not alter player/world state. While active, photo controls intercept overlapping traversal keys.

| Action | Key |
| --- | --- |
| Fly | `W` `A` `S` `D`; rise `Space` or `Q`; descend `Ctrl` or `E` |
| Speed / precision | `Shift` fast, `Alt` precise; `-`/`=` decrease/increase fly speed; `,`/`.` decrease/increase mouse sensitivity |
| Restore entry camera | `R` |
| FOV | mouse wheel; `0` restores entry FOV |
| Exposure | Left/Right arrows |
| Far focus / blur | `Z`/`X` focus distance; `C`/`V` blur amount |
| Color profile | `F` cycles Natural, Muted, Amber, and Vivid |
| Capture | `F12` standard; `F11` 2× shared-world capture, capped at 16,777,216 pixels |

Captures write a PNG plus JSON sidecar to `user://captures/`; the same `a-slow-walk.photo.v1` JSON is embedded in the PNG. The Compatibility renderer accepts exposure/FOV/filter controls, but Godot does not render depth-of-field blur on that backend. See [free-camera-controls.md](free-camera-controls.md), [photo-visual-controls.md](photo-visual-controls.md), [high-resolution-screenshot-capture.md](high-resolution-screenshot-capture.md), and [screenshot-metadata.md](screenshot-metadata.md).

## Verification

Bindings and rule behavior are covered by the owning deterministic tests:

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_food_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_water_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_recovery_movement_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/photo_mode_visual_regression_test.gd
```

## Dependencies

- `Settings`, `SpeedPlayer`, `SurvivalState`, `SurvivalMovementPolicy`, `WorldStreamer`, `PhotoMode`, and the expedition HUD.

## Performance

Control polling and survival updates use the existing active-expedition frame path. Field construction/crafting and photo capture are on-demand; high-resolution capture can briefly stall for render/readback. This guide adds no runtime work.

## Out of scope

Balance guarantees, accessibility remaps beyond existing Settings options, tutorial UI, controller bindings for unbound field actions, water physics, shelter persistence, replay capture, EXIF/XMP, and photo cloud sharing.
