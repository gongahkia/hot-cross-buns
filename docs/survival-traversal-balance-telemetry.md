# Survival and traversal balance telemetry

`SurvivalTraversalTelemetry` keeps per-expedition, time-weighted survival averages, minimum movement speed multiplier, maximum recovery pressure, time spent in movement states, action counts, and average style movement multiplier. F3 diagnostics expose the speed, pressure, style, and action aggregates while an expedition runs.

Dependencies: `SurvivalState`, `SurvivalMovementPolicy`, `StyleRun`, `SpeedPlayer`, and the expedition loop. Each active frame performs fixed-field numeric accumulation; action types are bounded to 32 named keys plus `other`.

Out of scope: persistent analytics, remote reporting, player identifiers, automatic balance changes, and telemetry outside procedural expeditions.
