# Temperature, weather, wetness, and exposure

Expeditions sample `WorldWeather` from the deterministic run seed and player position. `SurvivalState` accumulates precipitation-driven wetness, applies temperature, wind, wetness, and precipitation exposure to warmth, and dries in clearer, warmer, windier conditions. HUD `X` reports wetness/exposure.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/survival_exposure_test.gd
```

## Dependencies

- `WorldWeather`
- world samples
- `SurvivalState`
- `main.gd`

## Performance

One weather sample runs per active procedural frame.

## Out of scope

Visual weather layers, clothing, seasons, lightning, and hypothermia movement penalties.
