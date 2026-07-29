# Install and sync

`wukong install` and `wukong sync` are aliases. Both require an existing
`wukong.lock`, verify each selected local, Git, or HTTPS archive source and
prepared package checksum, then transactionally reconcile the project with the
lockfile. They never execute package scripts.

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
- `--offline` first verifies every selected cached Git checkout and HTTP archive.
  It reports all unavailable immutable artifacts before package preparation or
  project mutation, and does not start Git or an HTTPS request for a cache
  miss. A verified checkout for the locked Git commit is sufficient; mutable
  selector metadata is not required. Local-path sync performs no network I/O.
- `--godot <x.y.z>` validates an explicit active engine version against
  `[project].godot` before synchronisation.
- `--locked` recomputes direct source resolution and refuses any manifest,
  source, or lockfile mismatch before project mutation.
- `--frozen` combines `--locked` and `--offline`.
- `--json` emits versioned JSON Lines events for editor and automation clients;
  the terminal result contains written, unchanged, removed, and Godot
  compatibility-summary fields.
- Interactive terminals show package-level source/cache progress on stderr.
  `--no-progress` or `WUKONG_NO_PROGRESS=1` disables it; non-terminal and JSON
  output never contains ANSI progress rendering.

Without `--locked`, sync applies the existing lockfile but still verifies every
locked source and prepared package before it changes project files. Run
`wukong lock` after changing a manifest to update the selected dependency set.

See [project transactions](project-sync.md) and the [lockfile schema](lockfile.md).
