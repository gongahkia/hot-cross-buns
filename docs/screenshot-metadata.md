# Screenshot metadata

Each PNG capture stores the complete capture JSON in an uncompressed UTF-8 PNG `iTXt` chunk with the `a-slow-walk` keyword and in its readable `.json` sidecar. `PhotoMetadataSchema` builds and validates `a-slow-walk.photo.v1` before either artifact is written, so both carry the same JSON object.

## Schema

Required fields are `schema`, non-empty `run` and `world` objects, world `position` (`[x,y,z]`), `camera` (`position`, `fov`), positive integer `capture.width`/`height`, and UTC `captured_at` (`YYYY-MM-DDTHH:MM:SSZ`). Optional `extensions` carries JSON-only producer namespaces. Other top-level keys, invalid dimensions/FOV/timestamps, unsupported schema IDs, non-JSON values, excessive nesting, and payloads over 64 KiB are rejected.

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/photo_metadata_schema_test.gd
```

The fixture validates construction, source isolation, schema rejection cases, extension handling, and parsed parity between compact sidecar JSON and embedded PNG metadata.

## Dependencies

- `PhotoMode`, `PngMetadata`, Godot JSON/Time APIs, and the expedition metadata provider.

## Performance

Validation/encoding occur once per capture. Embedding rewrites the just-created PNG once, proportional to PNG bytes; metadata is bounded to 64 KiB and 32 nesting levels. It has no per-frame cost.

## Out of scope

EXIF/XMP, modifying existing external PNGs, encryption, signing, sharing, cloud sync, and replay identity.
