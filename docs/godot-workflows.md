# Godot project workflows

Wukong launches, validates, and exports a Godot project using the exact
toolchain recorded in its lock when one exists. It never executes package
scripts or reads executable arguments from package metadata.

```sh
wukong run --project path/to/game
wukong run --scene res://scenes/level.tscn --headless
wukong editor --project path/to/game
wukong export --project path/to/game --preset "Linux/X11" --output builds/game
wukong export --preset "Windows Desktop" --output builds/game.exe --debug
```

Pass additional Godot arguments only after `--`:

```sh
wukong run --project path/to/game -- --rendering-method gl_compatibility
```

`run` supports `--scene` and `--headless`. `editor` starts Godot with
`--editor`. `export` always uses `--headless` and requires `--preset` and
`--output`; it uses release exports by default or debug exports with `--debug`.
All actions accept `--project <path>`, `--godot-executable <path>`, and
`--godot <x.y.z> --flavor <standard|dotnet>`.

## Toolchain selection

For project actions and `wukong validate`, Wukong selects the first applicable
choice in this order:

1. `--godot-executable` or `WUKONG_GODOT_EXECUTABLE`.
2. An explicit managed `--godot <x.y.z>` and `--flavor`.
3. The managed editor recorded in `wukong.lock`.
4. `godot.executable`, `PATH`, then common platform locations.

Every selection is checked against `[project].godot`. A selected external
executable that differs from the locked toolchain is rejected by default; pass
`--allow-toolchain-override` only for an intentional non-reproducible local
override. The same flag is required when an explicit managed `--godot` differs
from `wukong.lock`.

When a matching managed editor is missing, Wukong downloads it automatically
by default. `export` also installs matching export templates when needed. Set
`wukong settings set godot.downloads manual` to disable automatic downloads;
Wukong then prints the exact `wukong godot install` command needed. Managed
downloads and extraction use the configured progress spinner and bar.

The child process owns standard input, output, and error after launch. Its exit
status becomes Wukong's command result. Ctrl-C requests cancellation, after
which Wukong terminates and reaps the direct Godot child. Godot itself may
write derived files in `.godot`; inspect these before committing project
changes.
