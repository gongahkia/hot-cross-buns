# Injury, fatigue, recovery, and movement penalties

`SurvivalState` tracks landing injuries separately from health. Resting with stable hunger, thirst, warmth, and exposure reduces fatigue and restores injury-linked health. `SpeedPlayer` reports movement state and exertion; `SurvivalMovementPolicy` applies the resulting speed cap each active expedition frame. Falls faster than the landing threshold emit an injury event after floor contact.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_recovery_movement_test.gd
```

## Dependencies

- `SurvivalState`
- `SurvivalMovementPolicy`
- `SpeedPlayer`
- `CharacterBody3D.move_and_slide`

## Performance

One pure policy evaluation runs per active procedural frame; landing injury checks run only on floor transitions.

## Out of scope

Combat injuries, medical items, debuffs beyond speed caps, accessibility settings, and balance tuning.
