# Godot executable discovery

`wukong godot path` locates, but never runs, a Godot executable:

```sh
wukong godot path
wukong godot path --godot-executable /path/to/godot
wukong godot path --verbose
```

Selection order is `--godot-executable`, `WUKONG_GODOT_EXECUTABLE`, the
user-scoped `godot.executable` setting, `PATH`, then common platform locations.
An invalid explicit, environment, or configured path is an error; Wukong never
silently falls through to a different executable.
`--verbose` prints the selection source before the executable path.

The command only checks that a usable executable file exists. Optional
headless execution is provided by [`wukong validate`](validation.md). See
[Godot workflows](godot-workflows.md) for `run`, `editor`, and `export`.
