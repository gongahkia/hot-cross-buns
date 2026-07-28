# ADR 0010: canonical package trees

## Status

Accepted

## Context

Fetched source trees may contain repository wrappers, source-control metadata,
and paths that collide on another supported filesystem. Later cache and install
steps need one verified tree with a portable, deterministic identity.

## Decision

Prepare only the source root selected by W031 layout detection into a new,
caller-provided staging directory. This excludes repository wrappers without
heuristics inside the selected addon root. Exclude `.git`, `.hg`, and `.svn`
administrative entries at every depth. Reject symlinks, special files,
non-UTF-8 names, and paths whose NFC-normalised, Unicode-lowercase form
collides with another path.

Normalise output path components to Unicode NFC. Copy regular files and empty
directories. On Unix, normalise file permissions to `0755` when any execute bit
was present and `0644` otherwise; on non-Unix platforms record no executable
bit. Hash sorted directory and file records with SHA-256, including normalised
paths, executable bits, and file bytes. On preparation failure, remove the
staging tree.

Use `unicode-normalization` 0.1.25 (MIT OR Apache-2.0, Rust 1.36) because the
standard library has no Unicode normalisation implementation. It is a
maintained, pure-Rust crate and confines its use to portable path handling.

## Consequences

Canonical trees are safe inputs to cache publication and materialisation.
Packages using symlinks must be transformed by a future explicit policy rather
than silently copied. Unicode/case collisions fail even on a case-sensitive
host, keeping prepared content portable across supported platforms.

## Alternatives considered

- Copy the fetched root unchanged: rejected because wrappers and VCS data would
  affect installed content.
- Allow host filesystem collision rules: rejected because output would differ
  across supported platforms.
- Preserve arbitrary permission bits: rejected because ownership and content
  state would vary by source host and umask.

## Migration and compatibility impact

The SHA-256 record format is a cache input. Any semantic change requires a new
ADR and a cache-key version change before cached trees can be reused.
