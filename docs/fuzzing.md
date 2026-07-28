# Fuzzing

Parser fuzzing uses `cargo-fuzz` and `libfuzzer-sys`. Rust's standard test
harness cannot generate coverage-guided malformed inputs, so the test-only
dependency is limited to `fuzz/` and does not ship in either product crate.

Run a bounded local campaign with nightly Rust:

```sh
cargo +nightly fuzz run manifest -- -max_total_time=60
cargo +nightly fuzz run lockfile -- -max_total_time=60
```

Tracked corpus seeds under `fuzz/corpus/` include valid and invalid manifests
and lockfiles. `crates/wukong-core/tests/fuzz_regressions.rs` executes every
tracked seed in normal test runs, so minimized crash inputs remain covered
without `cargo-fuzz`.

When a fuzzer finds a crash, minimize it with `cargo fuzz tmin`, add a reviewed
UTF-8 `.toml` result to the target corpus, and add a focused parser regression
test describing the fixed invariant. Never add credentials or private project
data to a corpus.

The scheduled GitHub Actions workflow runs each parser target for 60 seconds;
it is a bounded smoke campaign, not proof that the parser has no defects.
