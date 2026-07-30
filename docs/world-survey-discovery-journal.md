# World survey and discovery journal

`WorldSurveyJournal` records unique streamed-region entries and landmark proximity discoveries for the active procedural run. `WorldStreamer.landmark_at()` resolves the existing deterministic landmark record against the player position; `main.gd` checks it at four hertz and presents the journal from pause or title menus.

Dependencies: `WorldLandmarks`, `WorldStreamer`, and the procedural-region descriptors. The journal keeps only compact dictionaries, and the throttled proximity check performs one existing deterministic landmark lookup per quarter-second.

Out of scope: persistence across application sessions, map markers, rewards, fog-of-war rendering, and survey collection outside procedural expeditions.
