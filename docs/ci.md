# Offline and CI guide

CI should install a pinned Wukong release or immutable source tag, then run:

```sh
wukong sync --frozen --project <project-directory>
```

`--frozen` combines `--locked` and `--offline`: the manifest must match the
lockfile and every selected immutable Git checkout or HTTPS archive must
already be verified in the cache. Cache only Wukong's managed cache directory;
never cache credentials, manifests, lockfiles, project state, or arbitrary
working directories as a substitute for source pinning.

Populate the cache in an earlier trusted job with `wukong lock` and
`wukong sync`, or use a prebuilt cache containing only verified immutable
objects. A cache miss fails before project mutation and reports every missing
artifact. Local dependencies require their declared paths to exist in the CI
checkout and never need network access.

For machine-readable progress and errors, use a command's documented `--json`
mode and keep stdout separate from stderr. Do not upload unredacted manifests,
lockfiles, environment dumps, or verbose diagnostics. Git authentication must
remain in the CI runner's Git/SSH configuration; Wukong accepts no manifest
credentials and executes no package scripts.

The repository CI derives its Godot validation matrix from the reviewed
[`config/godot-support.toml`](../config/godot-support.toml) entries. Each job
downloads its exact official stable Linux release and runs the package-free
`fixtures/validation/minimal` project through `wukong validate` with a
60-second timeout. Recovery mode disables editor plugins, tool scripts, and
GDExtensions; no package-defined code path is selected by this validation.

The `native transactions` matrix records the real-filesystem transaction
fixtures separately on Linux, macOS, and Windows. It covers stale transaction
recovery, conflict rollback, safe removal, Unicode preservation, portable case
conflicts, and advisory lock contention. Fixtures use only temporary local
paths and do not place credentials in output or retained artifacts.

The release artifacts matrix builds the four native targets declared in the
[release artifact layout ADR](adr/0037-release-artifact-layout.md): macOS
arm64/x64, Linux x64, and Windows GNU x64. Each job invokes the checked-in
packaging script, verifies that the ZIP contains only its expected executable,
checks the sibling SHA-256 file, extracts the archive, and smoke-tests the
extracted native executable. The verified ZIP and checksum are retained as a
seven-day workflow artifact only; CI neither signs nor publishes a release.

The Tier-1 test matrix uses Ubuntu 24.04, macOS 15, and Windows Server 2025
with Rust 1.85.0 and the committed dependency lockfile. Temporary fixtures use
Rust's OS-native tempfile support; there are no platform-specific skips.
Ignored tests require external network access, supplied consented credentials,
or manually checked-out public sources, and each declares that reason beside
the ignore marker. On a workspace-test failure, CI retains only the test log
from repository fixtures for seven days. It does not upload project inputs,
cache directories, manifests, lockfiles, or environment dumps.

The audit action receives only the workflow's ephemeral read-only GitHub token
as its required action input. CI does not require a repository secret or broader
workflow permissions for auditing.
