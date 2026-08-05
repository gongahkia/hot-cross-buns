# Command reference

Run `wukong --help` for the command list and `wukong --version` for the
installed package version. Exit codes are documented in [diagnostics](diagnostics.md).

| Command | Purpose | Details |
| --- | --- | --- |
| `init [--project <path>] [--non-interactive]` | Create `wukong.toml` without overwriting one. | [init](init.md) |
| `add <alias> <--path\|--git\|--url> … [--dev]` | Edit, lock, and sync one direct dependency transactionally. | [add](add.md) |
| `remove <alias>` | Remove one direct dependency and safely reconcile owned files. | [remove](remove.md) |
| `lock [--offline] [--locked]` | Resolve direct sources and write a deterministic lockfile. | [lockfile](lockfile.md) |
| `install` / `sync` | Reconcile the project from `wukong.lock`. | [sync](sync.md) |
| `update [<alias>] [--dry-run]` | Re-lock selected supported dependencies and sync changes. | [update](update.md) |
| `tree [--json]` / `why <alias> [--json]` | Inspect locked dependency paths without resolving. | [dependency views](dependency-views.md) |
| `outdated [--offline] [--json]` | Report available Git tag updates without mutation. | [outdated](outdated.md) |
| `audit [--json]` | Display immutable locked provenance. | [audit](audit.md) |
| `status [--json]` | Read installed package identities from project state. | [installed state](installed-state.md) |
| `source list [--json]` | Inspect canonical reviewed source candidates without fetching. | [source catalog](source-catalog.md) |
| `cache <dir\|status\|clean\|verify>` | Inspect, verify, or conservatively clean managed cache entries. | [cache](cache.md) |
| `doctor` | Check local project, cache, lock, and configuration health. | [doctor](doctor.md) |
| `godot path` / `validate` | Discover Godot or run an explicitly requested bounded validation. | [validation](validation.md) |

`--project <path>` accepts a project directory or its `project.godot` file where
supported. `--offline` prohibits source network access, `--locked` refuses
manifest/lock drift, and `--frozen` combines both for sync. `--json` is a
versioned machine protocol only on commands that document it. `--quiet` and
`--verbose` are command-specific; do not parse human output in automation.
