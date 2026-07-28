# Godot executable discovery

`wukong godot path` locates, but never runs, a Godot executable:

```sh
wukong godot path
wukong godot path --godot-executable /path/to/godot
wukong godot path --verbose
```

Selection order is `--godot-executable`, `WUKONG_GODOT_EXECUTABLE`, `PATH`,
then common platform locations. An invalid explicit path or environment value
is an error; Wukong never silently falls through to a different executable.
`--verbose` prints the selection source before the executable path.

The command only checks that a usable executable file exists. W083 adds
optional headless execution separately.
