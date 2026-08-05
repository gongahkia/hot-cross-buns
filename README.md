# a-slow-walk

First-person survival traversal through deterministic, infinite reclaimed Earth.

## Current vertical slice

- Five generated macro-region families: reclaimed city, flooded city, industrial ruin, overgrown suburb, wilderness.
- Streamed terrain/collision chunks, traversal resources, survival state, local run records, photo mode.
- [Internal creative editor](docs/creative-levels.md) remains available for authored static levels, separate from procedural expeditions.

## Run

```sh
./script/build_and_run.sh
```

Headless checks:

```sh
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/smoke_test.gd
/Applications/Godot.app/Contents/MacOS/Godot --headless --path . --script res://scripts/level_cli.gd -- --validation-fixtures
uv --directory tools/level_mcp run --group test python -m pytest
```

## Controls

Default traversal, survival, field, photo, and controller bindings: [expedition-controls-survival-photo-mode.md](docs/expedition-controls-survival-photo-mode.md).

Photo captures and metadata are written to `user://captures/`.

## Release

[itch.io build, upload, and release checklist](docs/itchio-release-checklist.md).
