# Wildlife accessibility controls

Settings includes a persisted `Wildlife encounters` toggle. When disabled, active wildlife is hidden, does not run behavior, and rejects traversal contacts; world generation remains deterministic.

Dependencies: the Settings autoload and `WildlifeAgent`. The toggle is checked once per active wildlife frame.

Out of scope: changing terrain, resources, landmark generation, audio-only alternatives, or per-archetype controls.
