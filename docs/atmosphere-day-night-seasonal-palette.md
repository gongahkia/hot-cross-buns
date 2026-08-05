# Atmosphere, day/night, and seasonal palette

`WorldAtmosphere` presents existing deterministic weather fields as a 12-minute day/night cycle and a four-hour seasonal palette cycle. Cloud, precipitation intensity, and visibility darken the sky, increase fog, and attenuate sunlight; the expedition environment and sun update from the same weather clock.

The referenced upstream `atmosphere.lua` source was not available in this workspace or identifiable from an upstream search, so this is a deterministic Godot presentation approximation built from the ported climate/weather fields—not a line-for-line source port.

Dependencies: `WorldWeather`, the expedition `Environment`, and directional sun. Evaluation is constant-time per procedural frame.

Out of scope: physically based scattering, sky textures, stars, moon phases, seasonal terrain mutation, particle rendering, audio, and a fidelity claim against unavailable upstream source.
