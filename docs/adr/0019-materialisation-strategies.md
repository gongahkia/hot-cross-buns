# ADR 0019: materialisation strategies

## Status

Accepted

## Decision

Materialise each staged file with an explicit preference: `copy`, `hardlink`,
`reflink`, or `auto`. Auto probes reflink, then uses a standalone copy at the
actual staging destination; failure of the reflink removes any partial
destination before fallback. Explicit preferences never silently choose another
strategy. The state records the strategy selected per file.

Use `reflink-copy` 0.1.30 (MIT OR Apache-2.0) because Rust's standard library
does not expose APFS `clonefile` or Linux `FICLONE`. It adds no native build
step and compiled with Rust 1.85 locally, though the crate does not publish an
MSRV; dependency upgrades require the same check. Wukong invokes reflinks only
on macOS and Linux; Windows uses hardlink/copy fallback because the dependency
documents its Windows reflink implementation as untested.

## Consequences

No symlinks are created. Auto never uses hardlinks: a project edit to a
hardlinked package file could mutate a local source or cache object. Copy
remains universally available. Filesystems with unsupported reflinks use copies
without a performance claim.
