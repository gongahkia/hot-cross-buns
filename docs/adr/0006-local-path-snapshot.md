# ADR 0006: local-path snapshot identity

## Status

Accepted

## Context

Local dependencies must be reproducible enough to detect source changes while
remaining usable for development outside a project tree. Path strings alone are
mutable and equivalent paths may traverse symlinks differently. The standard
library has no SHA-256 implementation.

## Decision

Resolve a declared relative path lexically against `wukong.toml`, then require
an existing directory and filesystem-canonicalise its root. Paths outside the
Godot project are supported and identified by that canonical absolute path.

Compute a SHA-256 content snapshot from a sorted walk of the canonical root.
Each record includes its normalised relative path, entry kind, and either file
bytes or the literal symlink target. Symlinks inside the tree are not followed.
This detects a changed link without allowing it to expand the snapshot outside
the root. Ignore `.git` and caller-configured directory or file names at every
depth. The ignore set is sorted and forms part of the request configuration.

Use `sha2` 0.10.9, a pure-Rust MIT OR Apache-2.0 SHA-256 implementation,
because Rust's standard library does not provide a cryptographic hash.

## Consequences

The local adapter resolves to `sha256:<content digest>` as an immutable source
revision for the current snapshot. It performs no network I/O and is always
offline available. A local path changing after resolution produces a different
immutable revision. Package-layout selection and cache publication remain
deferred.

## Alternatives considered

- Hash only the root path or timestamps: rejected because content changes would
  be missed or metadata would make results nondeterministic.
- Follow symlinks: rejected because links can escape the source root or create
  cycles.
- Use a non-cryptographic standard-library hash: rejected because Rust does
  not provide a stable content-hash algorithm for persisted identities.

## Migration and compatibility impact

The snapshot format becomes a local source-resolution input. Future cache and
lockfile ADRs must record its algorithm identifier and preserve or explicitly
migrate this byte format.
