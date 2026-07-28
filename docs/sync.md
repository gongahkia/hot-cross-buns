# Install and sync

`wukong install` and `wukong sync` are aliases in the local-path vertical
slice. Both require an existing `wukong.lock`, verify each selected local
source and prepared package checksum, then transactionally reconcile the
project with the lockfile. They never execute package scripts.

```sh
wukong lock
wukong install
```

The commands print one stable summary: written, unchanged, and safely removed
file counts. A repeated sync is a no-op. Files absent from the new lockfile are
removed only when `.wukong/state.toml` proves Wukong ownership and their recorded
checksum still matches.

## Options

- `--project <path>` selects a Godot project directory or `project.godot`.
- `--dev` includes `[dev-dependencies]`; the default selects runtime dependencies
  only.
- `--offline` is accepted for automation. Local-path sync performs no network
  I/O.
- `--locked` recomputes the current local lock resolution and refuses any
  manifest, source, or lockfile mismatch before project mutation.
- `--frozen` is an alias for `--locked` in this local-only slice: there is no
  remote I/O to additionally prohibit.

Without `--locked`, sync applies the existing lockfile but still verifies every
locked local source and prepared package before it changes project files. Run
`wukong lock` after changing a manifest to update the selected dependency set.

See [project transactions](project-sync.md) and the [lockfile schema](lockfile.md).
