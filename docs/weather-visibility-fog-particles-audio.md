# Weather visibility, fog, particles, and audio

Weather layers derive fog/visibility from `WorldAtmosphere`, particle count from `WorldWeather.particle_count`, and a wind/rain/ice ambient cue from weather state. Active particles follow the player, remain world-space, and hide when their deterministic count is zero.

Dependencies: `WorldWeather`, `WorldAtmosphere`, `WeatherLayers`, expedition particles, and the Audio autoload. Profile evaluation is constant-time; particle count is bounded by the existing weather helper.

Out of scope: authored weather audio assets, thunder timing, volumetric fog, wet surfaces, particle collision, or visual screenshot baselines.
