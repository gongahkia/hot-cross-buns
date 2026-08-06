# User settings, managed Godot, and progress display

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
wukong settings set godot.downloads manual
wukong settings set godot.engine-dir /Volumes/fast-disk/wukong-engines
wukong settings get progress.spinner
wukong settings reset progress.spinner
wukong settings path
```

Schema one is still read. New writes use schema two:

```toml
schema = 2

[progress]
spinner = "simple-dots"
bar = "classic"

[godot]
executable = "/absolute/path/to/godot"
downloads = "automatic"
engine-dir = "/absolute/path/to/wukong-engines" # optional
```

`godot.executable` is an optional user-managed editor. `godot.downloads` is
`automatic` by default, allowing `run`, `editor`, `export`, and `validate` to
install a missing verified locked editor. Set it to `manual` to require an
explicit `wukong godot install <version> --flavor <standard|dotnet>` instead.
`godot.engine-dir` is an absolute Wukong-owned managed-engine root; it has the
same effect as `WUKONG_ENGINE_DIR`, except the environment variable wins for a
single invocation. Neither setting belongs in source control.

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
receive terminal-control sequences. Managed-editor resolution, verified
downloads, extraction, and template installation use this same spinner/bar
configuration. Byte downloads show a determinate bar with transferred and
total sizes; release resolution and extraction use the selected spinner.
