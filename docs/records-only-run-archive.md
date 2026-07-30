# Records-only run archive

`RunArchive` retains the latest 32 extracted or failed run summaries in memory. Each summary contains run identity, outcome, elapsed time, pickups, resource totals, region IDs, and final survival snapshot; it omits world chunks, replay inputs, and scene state. The title-screen Run records view lists resolved expeditions.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_archive_test.gd
```

## Dependencies

- `RunData.finish`
- extraction and failure resolution
- title-screen UI

## Performance

The archive is bounded to 32 compact dictionaries; append occurs only when a run resolves.

## Out of scope

Disk persistence, replay playback, world snapshots, cloud sync, and record deletion UI.
