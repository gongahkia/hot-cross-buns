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

Repository-wide GitHub Actions remain deferred until the account billing or
spending-limit issue is resolved; see [TODO wukong-002](../TODO.md).
