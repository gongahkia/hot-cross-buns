# Local save recovery

`scripts/local_save_store.gd` implements the `save-envelope/v1` recovery store for `user://` paths. It is a data-only service: callers pass a validated payload dictionary to `save()` and retrieve the newest valid payload with `load_latest()`.

## Write and recovery flow

1. Load valid primary, staging, and backup candidates to determine the next monotonic generation.
2. Write the new envelope to `*.tmp`, flush it, close it, and parse/validate it from disk.
3. Copy a valid primary to `*.bak`; a corrupt primary never replaces a valid backup.
4. Promote the validated staging file over primary with `DirAccess.rename_absolute`.
5. On load, validate primary, staging, and backup independently, then return the highest-generation valid envelope. Primary wins a generation tie.

The store rejects missing/invalid JSON, unsupported schema, non-positive generation, non-dictionary payload, and files larger than 4 MiB. It reports `primary`, `recovered`, or `missing_or_corrupt` rather than silently returning partial data.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/local_save_store_test.gd
```

The test writes two generations, corrupts primary, and verifies recovery returns the preserved prior generation.

## Dependencies

- Godot `FileAccess` for bounded writes/flushes and `DirAccess` for copy/rename.
- The save migration policy and deterministic run-record schema for payload validation at the caller boundary.

## Performance impact

Writes are synchronous and include staging validation plus an optional primary-to-backup copy. Save only at explicit checkpoints or bounded intervals; do not call it from the frame loop.

## Out of scope

- Process-wide automatic save scheduling, run-data integration, cloud sync, encryption, or conflict resolution.
- A guarantee against hardware, filesystem, or power-loss behavior beyond the file API’s documented flush/rename semantics.
- Repairing a payload that is syntactically valid but semantically incompatible with its run-record schema.
