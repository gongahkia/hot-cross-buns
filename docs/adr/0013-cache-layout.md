# ADR 0013: cache layout

## Status

Accepted

## Context

Prepared package content must be reusable without mixing downloads, source
checkouts, metadata, or process locks. Cache paths must follow platform
conventions and be deterministic from immutable content identities.

## Decision

Use a platform cache root, overridable by `WUKONG_CACHE_DIR`: XDG cache on
Linux, `~/Library/Caches` on macOS, and LocalAppData on Windows. Store Wukong
objects below `wukong/v1/` in `downloads`, `checkouts`, `packages`, `metadata`,
and `locks` directories. Prepared package objects use
`packages/sha256/<lowercase-digest>`; their process-lock paths use the matching
`locks/sha256/<lowercase-digest>.lock` name.

The layout API only derives paths. Publication, integrity verification, and
lock acquisition are separate later operations. No cache path contains a
credential, URL, host path, timestamp, or mutable source reference.

## Consequences

Schema changes create a new versioned root. Content-addressed objects can be
shared safely by future local source materialisation. Process locks are scoped
to one immutable object rather than a global cache lock.

## Alternatives considered

- A repository-local cache: rejected because it duplicates immutable data.
- One undifferentiated cache directory: rejected because lifecycle and access
  policies differ by object type.
- A platform-directory crate: rejected because its current published metadata
  does not declare a Rust MSRV; the small standard-library implementation is
  sufficient and directly testable.

## Migration and compatibility impact

New cache semantics require a new schema root. Existing roots are never
silently reinterpreted.
