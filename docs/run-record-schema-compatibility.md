# Run-record schema compatibility

`RunRecordSchema` is the strict reader for the documented `run-record/v1` envelope. It accepts only the current generator schema (`WorldGenerator.GENERATOR_SCHEMA_VERSION`), gameplay ruleset (`RunData.RULESET_VERSION`), 60 Hz fixed simulation boundary, canonical authoritative values, ordered replay spans/checkpoints, and a matching SHA-256 canonical payload hash. Authoritative envelope sections reject unknown fields; metadata accepts only `created_at`, `display_name`, and bounded `metadata.extensions.<producer>` data.

Existing `RunData.run_record` and `RunArchive` dictionaries are explicitly recognised as `legacy-summary/v0`. They remain records-only summaries: the compatibility reader does not upgrade them, synthesize replay data, or claim deterministic replay compatibility.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_record_schema_compatibility_test.gd
```

The fixture locks canonical bytes and SHA-256 output; covers legacy acceptance, metadata-only changes, generator/ruleset mismatch, tampering, unknown authoritative fields, replay gaps, and noncanonical seed text.

## Dependencies

- `WorldGenerator.GENERATOR_SCHEMA_VERSION`, `RunData.RULESET_VERSION`, and `RunExport` world identity.
- Godot `HashingContext`, fixed-tick replay producers, and the run-record policy.

## Performance

Validation and hashing run only during record load/export checks. Work is linear in bounded record bytes; metadata is capped at 64 KiB and canonical nesting at 32 levels. It has no per-frame cost.

## Out of scope

Writing or migrating v1 records, replay simulation/playback, historical schema readers, signatures, anti-cheat, network authority, and cloud sync.
