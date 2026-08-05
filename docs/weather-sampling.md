# Weather sampling and seasonal variation

`WorldWeather` ports deterministic 30-second weather buckets, regional event windows, advected fronts, pressure, precipitation and storm typing, visibility, audio cues, particles, and runtime clock progression.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_weather_test.gd
```

The fixture checks deterministic sampling, runtime buckets, labels, audio, visibility, and particles.

## Dependencies

- Seed, geologic time, climate, terrain, wind, pressure-cell, and optional Köppen fields.

## Performance impact

Constant time per weather sample; no event state storage is required.

## Out of scope

- Particle rendering, audio playback, networking, and weather persistence.
