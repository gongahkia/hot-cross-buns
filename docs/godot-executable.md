# Godot executable and managed toolchains

Wukong can use either an external Godot installation or a verified managed
editor. Inspect the current external selection without running it:

```sh
wukong godot path
wukong godot path --godot-executable /path/to/godot
wukong godot path --verbose
```

External selection order is `--godot-executable`, `WUKONG_GODOT_EXECUTABLE`,
the user-scoped `godot.executable` setting, `PATH`, then common platform
locations. An invalid explicit, environment, or configured path is an error;
Wukong never silently falls through to another executable. `path` checks only
that an executable file exists. `inspect` runs its bounded `--version` probe:

```sh
wukong godot inspect
wukong godot inspect --godot-executable /path/to/godot
wukong godot inspect --godot 4.5.3 --flavor standard
```

## Managed editors

Wukong downloads only verified official stable releases from
`godotengine/godot-builds`. It checks fixed artifact names, exact release byte
sizes, HTTPS origins and redirects, and SHA-512 values from the official
release checksum asset before staging an editor. The installation is then
published atomically into a Wukong-owned data root and checked with
`--version`. Wukong never changes or removes an external Godot installation.

```sh
wukong godot list
wukong godot list --available
wukong godot install 4.5.3 --flavor standard
wukong godot install 4.5.3 --flavor dotnet --templates
wukong godot remove 4.5.3 --flavor standard
```

`wukong godot list` shows valid Wukong-owned installations. `--available`
queries the latest official compatible stable release without downloading it.
`--templates` installs matching verified export templates through the owned
editor. Downloads are stored outside the project and outside Wukong's addon
cache; set `WUKONG_ENGINE_DIR` or `godot.engine-dir` to choose the owned root.

Use a manifest `[toolchain]` table or the convenience command below to make
the editor release reproducible for a project:

```sh
wukong godot pin 4.5.3 --flavor standard --project path/to/game
wukong godot update --project path/to/game
```

`pin` edits the manifest and regenerates its lock transactionally. `update`
only applies to an unpinned project and selects the newest compatible official
stable version. Neither command installs an editor unless the requested action
needs it. See [Godot workflows](godot-workflows.md) for selection during
`run`, `editor`, `export`, and validation.
