# Dependency resolution

`wukong-core` resolves package-owned `wukong-package.toml` metadata through a
source-neutral `PackageUniverse`. A universe is queried only when a direct or
transitive requirement needs its candidates; it must return immutable,
script-free candidate metadata and must not mutate the project.

The resolver uses `pubgrub` 0.3.0 behind the core boundary. Each requirement
is converted to the finite set of source-provided candidates that it permits,
preserving the workspace's Cargo-compatible SemVer and pre-release policy.
The selected graph is ordered by canonical package name. A valid version from
the existing lockfile is retained; otherwise the highest compatible candidate
is selected.

Resolution is cancellable and has no filesystem side effects. It rejects
candidate-version duplicates, reports PubGrub incompatibility derivations, and
rejects selected dependency cycles before a caller can materialise anything.
Package scripts are never executed.
