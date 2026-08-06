# `wukong add`

`wukong add` adds one direct dependency or one existing catalog root, resolves
the complete lock graph, and synchronises the project. It accepts exactly one
declaration:

```sh
wukong add my-addon --path ../my-addon --dev
wukong add remote-addon --git https://example.test/remote-addon.git --rev 0123456789abcdef0123456789abcdef01234567
wukong add archive-addon --url https://example.test/archive-addon.zip --sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
wukong add catalog-addon --version ^1 --offline
```

Local paths require `--dev`; this adds the entry to `[dev-dependencies]` and
includes it in the same synchronisation. `--project <path>` selects a Godot
project directory or `project.godot` file. Every selected source requires valid
`wukong-package.toml` with a matching package name.

`--version` adds a root resolved through the existing
[`wukong.sources.toml`](source-catalog.md) catalog. Add or review its candidate
first with `wukong source add`; `add` never overwrites the catalog. `--offline`
requires every selected catalog artifact to be cached before it changes the
manifest, lockfile, or project files.

The command validates and transactionally edits `wukong.toml`, constructs a
deterministic direct or catalog graph lockfile, and synchronises package files
without running scripts. If resolution, source retrieval, ownership validation,
or sync fails, it restores the exact prior manifest and lockfile bytes; the
catalog remains unchanged and project sync restores its own transaction. If a
concurrent edit prevents safe restoration, Wukong stops and reports that
rollback is incomplete instead of overwriting that edit.

## Removal

`wukong remove <alias>` removes a runtime dependency, rebuilds the direct or
catalog graph lockfile, and synchronises the project. If the alias is only in
`[dev-dependencies]`, it is selected automatically; use `--dev` to require the
development table. Required packages remain installed. Formerly package-owned
files modified by the user are retained, as are all unrelated project files.
`--offline` verifies only cached selected sources before the transaction.
