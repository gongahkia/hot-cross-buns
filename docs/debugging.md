# Debugging

Start with the narrowest deterministic command:

```sh
cargo +1.85.0 test -p wukong-core --test project_sync
cargo +1.85.0 test -p wukong-cli --test sync
wukong doctor --project <project-directory>
```

Use a disposable project directory for filesystem failures. Inspect
`wukong.toml`, `wukong.lock`, and `.wukong/state.toml` only after removing
credentials and private source details. `--json` provides versioned structured
output where supported; `--verbose` may expose redacted causal detail and
should not be pasted publicly without review.

For a panic or unexpected internal error, rerun the smallest test with
`RUST_BACKTRACE=1` locally. Do not enable backtraces in user-facing default
output. For archive, transaction, cache, credential, or path bugs, add a
focused security regression fixture before changing implementation.

Public bug reports use the repository's reproducibility form. It requires the
operating system, Wukong and Godot versions, a minimal manifest, a safe
lockfile response, redacted diagnostic output, and expected versus actual
behaviour. Report security-sensitive information through `SECURITY.md`, not a
public issue.

Godot executable validation is opt-in. Use `wukong godot path` to identify an
explicit executable; run the recorded headless compatibility procedure only on
a machine with the pinned runtime.
