# Godot compatibility input

`[project].godot` in `wukong.toml` is the project's declared Godot semantic
version requirement. It is authoritative and must be present.

```toml
[project]
name = "example"
godot = ">=4.4,<5"
```

`wukong lock` and `wukong sync` accept `--godot <x.y.z>` when the exact active
engine version is known:

```sh
wukong lock --godot 4.4.2
wukong sync --godot 4.4.2
```

The value must be a complete semantic version and satisfy `[project].godot`.
Validation occurs before lockfile or project-file mutation.

Wukong does not infer an engine version from `project.godot`. Godot documents
that file as project settings in INI format; settings and feature tags are not a
reliable installed-engine identity. Package constraint enforcement follows in
W081.

An optional `[toolchain]` table additionally selects one exact stable official
editor release. It must satisfy this project requirement, and the resulting
schema-four lockfile records its immutable editor and export-template artifacts.
At launch time Wukong inspects the actual selected executable; it rejects an
incompatible editor, or a version/flavor that differs from the lock, unless an
explicit `--allow-toolchain-override` accompanies a user-managed executable.
