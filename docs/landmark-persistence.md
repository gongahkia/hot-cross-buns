# Landmark persistence

`WorldLandmarks` stores one immutable record per deterministic region landmark: kind, designated chunk, and local coordinates. `WorldStreamer` keeps this state while chunks unload and recreates the landmark only when its designated chunk reloads.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_landmarks_test.gd
```

## Dependencies

- Region landmark selection, canonical region/chunk coordinates, and `WorldRng`.

## Performance impact

Only landmark-bearing regions allocate a small record. Unloaded chunks retain no landmark nodes.

## Out of scope

- Cross-session landmark mutations, discovery UI, and persistence after world-streamer destruction.
