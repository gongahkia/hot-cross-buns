# Creative levels

Open **Creative mode** from the title screen or pause menu, or press `F2` during play. The editor uses `WASD` to fly, `Space` to rise, `Shift` to descend, `Ctrl` to boost speed, and right-drag to control the free-fly camera. The mouse wheel zooms. Press `Tab` to switch between map and free-fly views; middle-drag pans the map, right-click selects a module, and right-drag selects every module whose projected position is within the viewport rectangle. Hold `Shift` to add selections or `Cmd`/`Ctrl` to remove them; `Cmd`/`Ctrl` + `A` selects all and `F` frames the selection. Left-click places a chosen module or selects one when no module is chosen.

Drafts are local and ignored by Git in `levels/_drafts/`. Save/publish only after reviewing the validation warnings and any estimated-reference assumptions. Published drafts appear in the normal level selector as additional playable levels.

## Relationship to expedition worlds

Creative authoring and infinite expedition are separate runtime paths. The editor is an internal authored-level workflow; it does not edit, seed, or preview the procedural expedition generator.

| Concern | Internal creative level | Procedural expedition |
| --- | --- | --- |
| Source | Local `a_slow_walk.level.v1` draft/published document and authored modules | Seeded `WorldGenerator`/`WorldStreamer` descriptors |
| World construction | `LevelBuilder` creates bounded authored geometry | Streaming generated chunks, terrain, collision, regions, resources, weather, and landmarks |
| Identity | Level document ID/revision and authoring history | `(seed, generator_schema_version, generation_options)` |
| Survival | Authoring is not a survival run; playtests do not call the procedural survival loop | Hunger, thirst, warmth, injury, weather exposure, recovery, and survival movement policy |
| Evidence | Local playtest report: path, events, checkpoints, heatmap, speed, resets, style, and collection counts | Resolved run archive, seed/run-card export, photo metadata, and survey data |
| Publication | Copy reviewed authored level JSON into `res://levels/` for the normal selector | No creative draft is merged into, or generated from, a procedural world |

During a creative playtest, `RunData` supplies elapsed/style/collection measurements and the normal player movement kit. Returning to the editor finalizes a local report and stops that run. It does not start `Survival`, stream a world, add a run-archive entry, resolve/export a run card, or claim deterministic expedition replay identity.

Published creative levels are selectable static authored courses. They use the document-level course loader and creative lighting, not `WorldStreamer`; publishing does not add a seed input, change generator schema/version/options, or alter an existing expedition. Conversely, expedition discovery, photos, survival, run records, and exports do not write into the authoring draft.

### Authoring flow

```text
local draft → validate/review → playtest evidence → optional manual approval
            → publish level JSON → level selector → static authored course

expedition seed → procedural streaming/survival → resolve → archive/export
```

Validation warnings and manual approval concern authored route quality and reference confidence. They are not proof that a procedural expedition seed is valid, balanced, or compatible. Keep draft locks/revisions intact when using the MCP server; its scope remains `levels/_drafts/` until explicit publish.

## Reference workflow

Import screenshots or blueprints through **Import reference**. They are non-colliding overlays and begin with `estimated` scale confidence. Use the reference selector and transform controls to pan, rotate, and crop a plan; enable grid snap before tracing. For top-down/orthographic plans, enter a real distance, click its two endpoints with **Calibrate plan**, then use **Trace wall** or **Trace route**. Traced modules retain reference-local source points plus calibrated/estimated confidence. Perspective screenshots remain estimated overlays.

Creative playtests persist local run evidence: path samples, movement/trigger events, speed, resets, style, checkpoint order/timing, missed checkpoints, and a sampled heatmap. Return to the editor after a run to inspect evidence, replay the ghost, or show the heatmap; approve only when the evidence is for the current revision and reaches every authored checkpoint. Approval is an editor-only manual action.

## MCP workflow

Copy [`mcp.json`](../mcp.json) into an MCP-capable agent configuration or run:

```sh
uv --directory tools/level_mcp run a-slow-walk-level-mcp
```

The server exposes module catalog, draft read/create, revision-checked transactions, durable revision list/diff/rollback, validation, SVG preview, reference import, playtest-report read, and explicit publish tools. Godot and MCP share a local lock directory for draft mutations; every MCP mutation requires `expected_revision`, and stale/busy edits are rejected without auto-merge. Compact changes are retained with periodic snapshots. It only edits `levels/_drafts/` until `publish_draft` is called.

Use this prompt pattern:

```text
Use the a-slow-walk level MCP. Create a named local draft from this screenshot,
keep every inferred dimension marked estimated, get the current revision before each
transaction, then return validation warnings and the preview path. Do not claim it is
viable, manually approve, or publish it until I review it.
```

## Verification

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/level_cli.gd -- --validation-fixtures
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd
uv --directory tools/level_mcp run --group test python -m pytest
```

The level fixture validates document rules; smoke exercises editor open/build/playtest/return and draft conflict handling; MCP tests cover revision/publish behavior. They do not certify authored routes or procedural-world parity.

## Dependencies

- `CreativeEditor`, `LevelDocument`, `LevelBuilder`, `LevelLibrary`, local draft storage/locks, and the optional level MCP server.
- Expedition code remains separately owned by `WorldGenerator`, `WorldStreamer`, `Survival`, `RunData`, `RunArchive`, and export/photo systems.

## Performance

Authoring rebuilds only changed module geometry where possible. Playtest sampling is bounded and local; document validation/publish run on explicit actions. Neither path adds work to procedural streaming or an ordinary expedition frame.

## Out of scope

Converting authored geometry into procedural generation rules, importing procedural regions into a draft, shared/network authoring, automatic route approval, automatic publication, cloud draft sync, and treating creative playtest evidence as an expedition run record.
