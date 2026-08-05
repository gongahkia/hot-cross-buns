# Death and failure resolution

When `SurvivalState` depletes, the expedition records a `failed` outcome with the survival failure cause, disables movement, and presents retry/title choices. The resolved run retains elapsed time, resources, discoveries, style, and final survival data for later archive work.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_failure_test.gd
```

## Dependencies

- `SurvivalState.depleted`
- `RunData.finish`
- expedition menu/UI

## Performance

Resolution allocates one final run record only on terminal depletion.

## Out of scope

Death animations, corpse recovery, permanent progression, local archive persistence, and multiplayer recovery.
