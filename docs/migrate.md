# Migrate

`wukong migrate` preflights and converts a schema-two direct-source lock into
version-only manifest roots, `wukong.sources.toml`, and a schema-three catalog
graph lock. It does not materialise package files.

```sh
wukong migrate --dry-run
wukong migrate
```

The migration supports checksum-pinned HTTPS archives and Git dependencies
selected by semantic-version tags when their locked package root is a non-empty
safe source-relative path. Before any project file changes, Wukong
resolves the generated catalog and verifies that every selected package keeps
the same version, immutable source, canonical package checksum, dependency
edges, source root, target, and Godot compatibility.

Local paths, AssetLib entries, Git branches and exact Git revisions are
actionable blockers because a source catalog cannot represent them without
changing their selection semantics. Packages without valid
`wukong-package.toml` are blockers as well. Repair the reported input, run
`wukong lock`, and retry.

`--dry-run` uses only cached source artifacts and temporary staging; it writes
no cache objects, manifest, catalog, lockfile, installed-state data, or backup
files. A successful non-preview migration atomically replaces each project file
only after complete preflight. If a later replacement fails, Wukong restores
earlier files only when their bytes still match the value it wrote, avoiding a
concurrent-edit overwrite.
