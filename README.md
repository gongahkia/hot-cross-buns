# wukong

`wukong` is a Rust package and dependency manager for Godot 4 addons.

Its target is reproducible, declarative addon management: the same manifest,
lockfile, and source content should produce the same project addon state.

## Status

Pre-alpha. The repository currently provides the Rust workspace foundation and
validation baseline. No package-management command is implemented yet.

## Project documents

- [Product requirements](PRD.md)
- [Implementation roadmap](TODO.md)
- [Architecture](docs/architecture.md)
- [Architecture decision records](docs/adr/README.md)
- [Benchmark methodology](docs/benchmarks.md)
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
