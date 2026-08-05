# Endless-run pacing soak simulation

`EndlessRunPacingSimulation` runs a deterministic two-hour expedition model at one-second steps. It alternates 40 seconds of sprint travel with 80 seconds of sheltered rest, applies seeded 480-second weather cycles, resupplies one food and water every 90 seconds, and captures `SurvivalTraversalTelemetry` aggregates.

Dependencies: `SurvivalState`, `SurvivalMovementPolicy`, `SurvivalTraversalTelemetry`, and `WorldRng`. The headless soak uses no scene tree, world streaming, rendering, or real-time wait; the default 7,200 steps complete synchronously.

Out of scope: validating resource availability, player input/physics, world hazards, a claim that the cadence is balanced, runtime automated play, and production telemetry persistence.
