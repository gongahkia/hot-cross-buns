# Deterministic seed sharing and run-card export

Exports package a world identity for manual transfer or inspection. They do not upload anything, create a share link, or provide an in-game seed/import screen. A recipient can inspect the files, compare identity fields with a compatible build, and retain them as evidence; current gameplay does not load an exported manifest to start an expedition.

## World identity

Every `a-slow-walk.export.v1` manifest carries:

```json
"world": {
  "seed": "20260730",
  "generator_schema_version": "1.0.0",
  "generation_options": {}
}
```

The seed is decimal text, not a JSON number. All three fields form the identity: the same seed alone is insufficient after a generator-version or generation-option change. Compare the complete tuple exactly and retain the original export when it differs. Do not edit a version field to force compatibility; the current runtime has no migration/import path for an incompatible world identity. See [deterministic-seed-version-policy.md](deterministic-seed-version-policy.md).

## Triggers and artifacts

| Trigger | Files under `user://exports` | Contents |
| --- | --- | --- |
| A run resolves as extracted or failed | `seed-<seed>.json`; `run-card-<id>.json`; matching `run-card-<id>.svg` | Seed identity; run outcome, level, elapsed time, pickups, resource totals, discovered regions, survival snapshot; deterministic 1200×630 local SVG card. |
| **Export** beside an archived Run records entry | A new unique run-card JSON/SVG pair | Re-exports that in-memory archived summary. |
| **Export current seed** while a run is active | A new unique seed manifest | Current run world identity only. |
| Photo capture | `photos/<capture>.png`; `photos/<capture>.json`; `photo-<capture>.json` | Copied PNG, JSON sidecar, and photo-export manifest containing their filenames, world identity, and capture object. |

If a target name already exists, the exporter adds `-2`, `-3`, and so on; it does not overwrite the earlier artifact. Resolved-run exports occur during resolution, photo exports occur after capture, and UI exports occur only when their button is activated. These operations do not run per frame.

## Run-card workflow

1. Finish or fail an expedition to produce its automatic seed and run-card exports.
2. From the title screen, choose **Run records** and select **Export** to create another copy of an archived card. The in-memory archive retains up to 32 resolved summaries.
3. Share the JSON/SVG pair and seed manifest by an external transfer method of your choice. The SVG is a local presentation of the run card; the JSON carries the structured fields.
4. Keep the seed manifest with the run card/photo. Compare seed, generator schema version, and generation options before describing two artifacts as the same generated world.

Photo capture metadata is embedded in the PNG and written as a sidecar before its export copy is made; see [screenshot-metadata.md](screenshot-metadata.md). Run-card SVG layout/escaping is described in [local-run-card-renderer.md](local-run-card-renderer.md).

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_export_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/run_card_renderer_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/world_generation_golden_test.gd
```

The export fixture locks manifest identity; the renderer fixture locks deterministic SVG content/escaping; golden generation fixtures cover compatible world descriptors, rather than claiming that a seed alone proves compatibility.

## Dependencies

- `RunData`, `RunArchive`, `RunExport`, `RunCardRenderer`, `PhotoMode`, `PhotoMetadataSchema`, and `WorldGenerator.GENERATOR_SCHEMA_VERSION`.

## Performance

Manifest/SVG construction and file copies occur only at capture, resolution, or an Export click. The run-card renderer performs one bounded string build; photo export copies the already-created image and sidecar. There is no network, background sync, or per-frame export work.

## Out of scope

In-game seed entry/import, automatic world reconstruction, schema migration, cloud sync, server-hosted links, social sharing, cryptographic signatures, ownership verification, thumbnails, and cross-platform font-pixel identity for SVG rendering.
