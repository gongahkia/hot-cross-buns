# ADR 0002: manifest initialisation transaction

## Status

Accepted

## Context

`wukong init` creates the project-owned `wukong.toml`. It must never overwrite
an existing file and must not expose a partially written manifest to another
process. The standard library's `rename` overwrites an existing destination on
Unix, so checking for existence before a rename leaves a race.

## Decision

Generate deterministic manifest bytes in memory. Write and sync a uniquely
named temporary file in the manifest's parent directory. Publish it by creating
a hard link at `wukong.toml`; this is an atomic no-replace operation because it
fails when the destination exists. Remove the temporary link after publication.

If the destination exists before or during publication, return a user error and
leave it unchanged. If staging or publication fails, remove only the temporary
file created by this operation. A filesystem that does not support hard links
returns a recoverable error rather than falling back to an overwrite-prone
operation.

This decision covers initial manifest creation only. General installation
transactions, recovery records, and multi-file commits remain deferred to the
transaction roadmap issues.

## Consequences

The published manifest is always a complete file and concurrent `init` calls
have one winner. Success requires hard-link support in the project filesystem.
Temporary names are not persisted and do not affect output determinism.

## Alternatives considered

- `create_new` on the final path: prevents overwrites but exposes an empty or
  partial manifest if writing is interrupted.
- `rename` after a preflight existence check: atomic replacement on Unix can
  overwrite a manifest created concurrently.
- A process-local lock: cannot protect independent processes.

## Migration and compatibility impact

No on-disk format migration is required. A future general transaction ADR may
supersede this implementation while retaining its no-overwrite guarantee.
