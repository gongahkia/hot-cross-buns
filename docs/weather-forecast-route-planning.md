# Weather forecast and route planning

`WorldWeather.forecast` samples deterministic weather at route cells using ETA from travel distance. The expedition HUD forecasts forward, left, and right routes with weather labels and a 0–100 exposure-risk score. Results cache by weather bucket and 48-metre player cell, so route planning does not change world state.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_weather_test.gd
```

## Dependencies

- `WorldWeather`
- `WorldStreamer` terrain/climate samples
- player facing direction
- expedition HUD

## Performance

Three forecast samples run only when the weather bucket or local forecast cell changes.

## Out of scope

Map UI, persistent waypoints, precise pathfinding, forecast uncertainty, and visual weather effects.
