# a-slow-walk level MCP

Run locally from the project root:

```sh
uv --directory tools/level_mcp run a-slow-walk-level-mcp
```

Set `ASW_PROJECT_ROOT` only when the server is launched outside this checkout. Tools edit `levels/_drafts/` only; `publish_draft` explicitly copies a draft to tracked `levels/`. Read a draft first, then pass its `revision` as `expected_revision` to every mutation. MCP and Godot share a local lock directory, stale/busy edits are rejected, compact revision diffs use periodic snapshots, and up to 20 local playtest reports survive server restarts.
