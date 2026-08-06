# User settings and progress display

Wukong's visual preferences are user-scoped. They do not belong in
`wukong.toml`, `wukong.lock`, or source control.

The settings file is `settings.toml` below these platform directories:

- macOS: `~/Library/Application Support/wukong/`
- Linux: `$XDG_CONFIG_HOME/wukong/`, falling back to `~/.config/wukong/`
- Windows: `%APPDATA%\wukong\`

Set `WUKONG_CONFIG_DIR` to use another configuration root, such as a temporary
directory in automation. Wukong appends `wukong/settings.toml` to that root.

```sh
wukong settings list-spinners
wukong settings set progress.spinner dots
wukong settings set progress.bar rect
wukong settings get progress.spinner
wukong settings reset progress.spinner
wukong settings path
```

The schema-one file has this shape:

```toml
schema = 1

[progress]
spinner = "simple-dots"
bar = "classic"

[godot]
executable = "/absolute/path/to/godot"
```

`simple-dots` is the default because it is ASCII-only. `list-spinners` exposes
every available Rattles preset; `list-bars` exposes Wukong's `classic`,
`legacy`, `shades-classic`, `shades-grey`, and `rect` themes.

For one invocation, use `--progress-spinner <name>` or
`--progress-bar <name>`. The matching `WUKONG_PROGRESS_SPINNER` and
`WUKONG_PROGRESS_BAR` environment variables override settings when no command
flag is supplied. Flags win over environment variables, which win over the
settings file and built-in defaults.

Progress is an interactive stderr display only. `--no-progress` and
`WUKONG_NO_PROGRESS=1` disable it. JSON and non-terminal invocations never
receive terminal-control sequences.
