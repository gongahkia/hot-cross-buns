# ADR 0003: manifest edit transaction

## Status

Accepted

## Context

`wukong add` and `wukong remove` modify an existing project-owned manifest.
The update must preserve either the previous complete file or the newly
validated complete file; it must never write edits incrementally. Rust's
standard-library rename replaces a destination atomically on Unix but does not
replace an existing destination on Windows.

## Decision

Parse and validate the complete edited manifest before filesystem mutation.
Write and sync a sibling temporary file. On Unix, atomically replace the
existing manifest with `rename`. On Windows, rename the existing manifest to a
unique sibling rollback path, rename the staged file to the manifest path, and
restore the rollback file if publication fails. Remove the rollback file only
after successful publication.

The editor rejects an input manifest that fails the v1 parser and verifies the
staged output with that same parser before commit. It modifies only
`dependencies` or `dev-dependencies`, preserving untouched TOML items and
their comments. Dependency keys in the modified table are sorted
lexicographically; inline-source fields use a fixed order.

## Consequences

Normal failures retain or restore the preceding complete manifest. Unix has
atomic replacement. Windows has a brief commit interval where a process crash
can leave the rollback file instead of `wukong.toml`; durable recovery records
and cross-process locking are deferred to the general transaction work.

## Alternatives considered

- Directly rewrite `wukong.toml`: rejected because interruptions can expose a
  partial manifest.
- Use an atomic replace API from a platform-specific crate: deferred to avoid a
  native dependency for this narrow early slice.
- Use a permanent backup file: rejected because it introduces persistent,
  project-visible state without a recovery protocol.

## Migration and compatibility impact

No manifest schema change is introduced. A future transaction ADR may
supersede the Windows commit mechanism after adding durable recovery.
