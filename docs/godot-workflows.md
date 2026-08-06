# Godot project workflows

Wukong can launch an installed Godot engine after resolving the project root.
It does not download Godot, execute package scripts, or read executable
arguments from package metadata.

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
All actions accept `--project <path>` and `--godot-executable <path>`.

The child process owns standard input, output, and error after launch. Its exit
status becomes Wukong's command result. Ctrl-C requests cancellation, after
which Wukong terminates and reaps the direct Godot child. Godot itself may write
derived files in `.godot`; inspect these before committing project changes.
