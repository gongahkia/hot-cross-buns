# Survival-aware movement feedback

The expedition HUD presents the current survival movement penalty as an optimal, strained, fatigued, critical, or incapacitated state. It derives only from `SurvivalMovementPolicy`, so the displayed multiplier matches the multiplier supplied to `SpeedPlayer`.

Dependencies: `SurvivalState`, `SurvivalMovementPolicy`, and the expedition HUD. The mapping is constant-time and occurs during existing HUD refreshes; it adds no simulation or world-streaming work.

Out of scope: modifying speed penalties, adding screen effects/audio, accessibility alternatives, or changing survival drain and recovery.
