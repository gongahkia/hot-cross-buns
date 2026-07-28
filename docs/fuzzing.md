# Fuzzing

Manifest, lockfile, and ZIP extraction fuzzing use `cargo-fuzz` and
`libfuzzer-sys`. Rust's standard test harness cannot generate coverage-guided
malformed inputs, so test-only fuzz dependencies are limited to `fuzz/` and do
not ship in either product crate.

Run a bounded local campaign with nightly Rust:

```sh
cargo +nightly fuzz run manifest -- -max_total_time=60
cargo +nightly fuzz run lockfile -- -max_total_time=60
cargo +nightly fuzz run archive -- -max_total_time=60
```

Tracked corpus seeds under `fuzz/corpus/` include valid and invalid manifests
and lockfiles plus malformed, traversal, and Unicode archive inputs.
`crates/wukong-core/tests/fuzz_regressions.rs` executes every tracked parser
and raw-archive seed in normal test runs, so minimized crash inputs remain
covered without `cargo-fuzz`.

The archive target fuzzes raw ZIP bytes and bounded generated ZIP entries. Its
generated entries vary paths, duplicate names, Unicode, symlink records, and
compressed content while retaining a 16 KiB expansion harness limit.

When a fuzzer finds a crash, minimize it with `cargo fuzz tmin`, add a reviewed
UTF-8 `.toml` parser result or reviewed archive fixture to the target
corpus, and add a focused regression test describing the fixed invariant. Never
add credentials or private project data to a corpus.

The scheduled GitHub Actions workflow runs each target for 60 seconds; it is a
bounded smoke campaign, not proof that the parser or extractor has no defects.
