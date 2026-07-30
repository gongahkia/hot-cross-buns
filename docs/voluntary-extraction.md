# Voluntary extraction

The `extract` action (default `X`) pauses an active expedition and asks for confirmation. Confirming writes an `extracted` outcome into the immutable run record, stops player movement, and returns to the title screen. The resolved record remains available to later archive work.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_extraction_test.gd
```

## Dependencies

- `RunData`
- `SurvivalState` snapshot
- Settings input bindings
- expedition menu/UI

## Performance

No per-frame allocation beyond one input check; record creation occurs only on confirmation.

## Out of scope

Extraction zones, save/archive persistence, score screens, failed-run resolution, and multiplayer confirmation.
