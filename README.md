# wukong

`wukong` is a Rust package and dependency manager for Godot 4 addons.

Its target is reproducible, declarative addon management: the same manifest,
lockfile, and source content should produce the same project addon state.

## Status

Pre-alpha. The local-path vertical slice provides `wukong init`, `wukong lock`,
and transactional `wukong install`/`wukong sync`. `wukong cache verify` verifies
prepared-package cache objects; `wukong cache dir`, `status`, and conservative
`clean --dry-run`/`clean` provide cache maintenance. Git canonicalisation and core fetching are
implemented. HTTPS archive retrieval and immutable checksum-addressed caching
are implemented in the core. `wukong lock` supports direct path, Git, and HTTP
dependencies. `wukong add` resolves and synchronises direct path, Git, and
HTTPS archive sources transactionally; `wukong tree`/`wukong why` inspect the
resolved lock graph. `wukong update [package]` re-locks supported direct sources
and synchronises changes transactionally, with a dry-run preview. The core
dependency solver is available for source-adapter integration; official asset
sources and package scripts are not implemented. `wukong outdated` reports
Git tag updates without changing the project. `wukong doctor` checks local
project, cache, executable, network-configuration, and lock health.

## Local-path workflow

```sh
wukong lock
wukong install
```

`install`/`sync` reconcile the existing lockfile through a rollback transaction
and never execute package scripts. See [local sync behaviour](docs/sync.md).

## Project documents

- [Product requirements](PRD.md)
- [Implementation roadmap](TODO.md)
- [Architecture](docs/architecture.md)
- [Architecture decision records](docs/adr/README.md)
- [Threat model](docs/threat-model.md)
- [Fuzzing](docs/fuzzing.md)
- [Benchmark methodology](docs/benchmarks.md)
- [Diagnostics](docs/diagnostics.md)
- [Credential handling](docs/credentials.md)
- [`wukong doctor`](docs/doctor.md)
- [Project discovery](docs/project-discovery.md)
- [Manifest schema](docs/manifest.md)
- [Package identity](docs/package-identity.md)
- [Source adapters](docs/source-adapters.md)
- [Local paths](docs/local-paths.md)
- [Git source canonicalisation](docs/git-sources.md)
- [Git fetching](docs/git-fetching.md)
- [HTTP archives](docs/http-archives.md)
- [Archive extraction](docs/archive-extraction.md)
- [Package layout](docs/package-layout.md)
- [Package metadata](docs/package-metadata.md)
- [Godot compatibility input](docs/godot-compatibility.md)
- [Godot compatibility enforcement](docs/godot-compatibility-enforcement.md)
- [Godot executable discovery](docs/godot-executable.md)
- [Headless project validation](docs/validation.md)
- [Canonical package trees](docs/canonical-package-trees.md)
- [Compatibility fixtures](docs/compatibility-fixtures.md)
- [Lockfile schema](docs/lockfile.md)
- [Cache layout](docs/cache.md)
- [Installed state](docs/installed-state.md)
- [Ownership maps](docs/ownership.md)
- [Project synchronisation](docs/project-sync.md)
- [Install and sync](docs/sync.md)
- [Dependency views](docs/dependency-views.md)
- [`wukong add`](docs/add.md)
- [`wukong update`](docs/update.md)
- [`wukong outdated`](docs/outdated.md)
- [Materialisation](docs/materialization.md)
- [`wukong init`](docs/init.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Development

Rust 1.85 or newer is required. Before proposing a change, run:

```sh
cargo fmt --all -- --check
cargo build --workspace
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

## License

MIT. See [LICENSE](LICENSE).
