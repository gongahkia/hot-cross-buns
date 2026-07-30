# Survival-meter movement policy

`SurvivalMovementPolicy` defines a pure meter-to-movement contract for walk, sprint, slide, dash, glide, and grapple. Low hunger/thirst/warmth/health and high fatigue lower a state-weighted speed multiplier to a `0.65` floor; alive states remain available so the policy preserves a recovery route.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_movement_policy_test.gd
```

## Dependencies

- `SurvivalState.snapshot` fields only.

## Performance impact

- Pure, allocation-small policy evaluation; it is not yet applied by `SpeedPlayer`.

## Out of scope

- Controller integration, meter depletion/consumption, injury recovery, accessibility settings, and balance tuning.
