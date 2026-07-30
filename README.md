# a-slow-walk

First-person survival traversal through deterministic, infinite reclaimed Earth.

## Current vertical slice

- Five generated macro-region families: reclaimed city, flooded city, industrial ruin, overgrown suburb, wilderness.
- Streamed terrain/collision chunks, traversal resources, survival state, local run records, photo mode.
- Internal creative editor remains available.

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

`WASD` move, `Space` jump, `Shift` dash, `Ctrl` sprint, `C` slide, `E` tether, `F` glide, `Q` slam, `R` reset, `F3` diagnostics, `P` photo mode, `F12` photo capture.

Photo captures and metadata are written to `user://captures/`.
