# Creative levels

Open **Creative mode** from the title screen or pause menu, or press `F2` during play. The editor uses `WASD`/`Q`/`E` to fly, right-drag to look, `Tab` to switch between map and free-fly views, and left-click to place or select modules.

Drafts are local and ignored by Git in `levels/_drafts/`. Save/publish only after reviewing the validation warnings and any estimated-reference assumptions. Published drafts appear in the normal level selector as additional playable levels.

## Reference workflow

Import screenshots or blueprints through **Import reference**. They are non-colliding overlays and begin with `estimated` scale confidence. For top-down/orthographic plans, enter a real distance, click its two endpoints with **Calibrate plan**, then use **Trace wall** or **Trace route**. Traced modules retain reference provenance and calibrated/estimated confidence. Perspective screenshots remain estimated overlays.

Creative playtests persist local run evidence: path samples, movement/trigger events, speed, resets, style, and checkpoints. Return to the editor after a run, then approve only when the evidence is for the current revision and reaches every authored checkpoint. Approval is an editor-only manual action.

## MCP workflow

Copy [`mcp.json`](../mcp.json) into an MCP-capable agent configuration or run:

```sh
uv --directory tools/level_mcp run a-slow-walk-level-mcp
```

The server exposes module catalog, draft read/create, revision-checked transactions, durable revision list/diff/rollback, validation, SVG preview, reference import, playtest-report read, and explicit publish tools. Every MCP mutation requires `expected_revision`; stale edits are rejected without auto-merge. It only edits `levels/_drafts/` until `publish_draft` is called.

Use this prompt pattern:

```text
Use the a-slow-walk level MCP. Create a named local draft from this screenshot,
keep every inferred dimension marked estimated, get the current revision before each
transaction, then return validation warnings and the preview path. Do not claim it is
viable, manually approve, or publish it until I review it.
```
