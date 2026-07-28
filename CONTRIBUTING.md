# Contributing

## Scope

Work on one `TODO.md` issue per change. Do not begin later phases before their
listed acceptance criteria are satisfied. Preserve unrelated files.

## Requirements

- Use supported Rust, currently 1.85 or newer.
- Add tests for user-visible behaviour and regression fixtures for bugs.
- Update documentation with externally visible changes.
- Do not execute package scripts or add unsupported source adapters.
- Keep persisted output deterministic and filesystem mutation transactional.

## Validation

Run these commands before proposing a change:

```sh
cargo fmt --all -- --check
cargo build --workspace
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

## Licensing

Contributions must be compatible with the project's MIT license. See
[`LICENSE`](LICENSE).
