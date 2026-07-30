# Landmark and biome arrival presentation

`WorldArrivalPresentation` converts the streamed region descriptor and its local biome sample into a three-line HUD arrival notice: region name, region-family/biome, and an optional landmark callout. `main.gd` presents it only when `WorldStreamer.region_changed` emits, so it has no per-frame UI work or additional world-generation queries.

The feature depends on the existing deterministic region, biome, and landmark fields. It does not add landmark discovery, navigation markers, localization, or cinematic camera behavior; landmark survey remains proximity-driven.
