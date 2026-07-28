# wukong

`wukong` is a Rust package and dependency manager for Godot 4 addons.

Its target is reproducible, declarative addon management: the same manifest,
lockfile, and source content should produce the same project addon state.

## Status

Pre-alpha. `wukong init` creates a minimal manifest for a discovered Godot
project. Project discovery and manifest parsing are available in the core
library; package installation is not implemented yet.

## Project documents

- [Product requirements](PRD.md)
- [Implementation roadmap](TODO.md)
- [Architecture](docs/architecture.md)
- [Architecture decision records](docs/adr/README.md)
- [Benchmark methodology](docs/benchmarks.md)
- [Diagnostics](docs/diagnostics.md)
- [Project discovery](docs/project-discovery.md)
- [Manifest schema](docs/manifest.md)
- [Package identity](docs/package-identity.md)
- [Source adapters](docs/source-adapters.md)
- [Local paths](docs/local-paths.md)
- [Archive extraction](docs/archive-extraction.md)
- [Package layout](docs/package-layout.md)
- [Package metadata](docs/package-metadata.md)
- [Canonical package trees](docs/canonical-package-trees.md)
- [Compatibility fixtures](docs/compatibility-fixtures.md)
- [Lockfile schema](docs/lockfile.md)
- [Cache layout](docs/cache.md)
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
