# `wukong add`

`wukong add` adds one direct dependency, resolves its complete direct lockfile,
and synchronises the project. It accepts exactly one source declaration:

```sh
wukong add my-addon --path ../my-addon
wukong add remote-addon --git https://example.test/remote-addon.git --rev 0123456789abcdef0123456789abcdef01234567
wukong add archive-addon --url https://example.test/archive-addon.zip --sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Use `--dev` to add the entry to `[dev-dependencies]` and include it in the
same synchronisation. `--project <path>` selects a Godot project directory or
`project.godot` file.

The command validates and transactionally edits `wukong.toml`, constructs a
deterministic lockfile, and synchronises package files without running scripts.
If resolution, source retrieval, ownership validation, or sync fails, it
restores the exact prior manifest and lockfile bytes; project sync restores its
own transaction. If a concurrent edit prevents safe restoration, Wukong stops
and reports that rollback is incomplete instead of overwriting that edit.
