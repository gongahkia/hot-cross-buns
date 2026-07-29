# ADR 0040: direct-sync prepared-cache reuse

## Status

Accepted

## Context

Direct sync previously copied and re-hashed every locked package into a new
temporary tree, including no-op synchronisations, despite prepared content
already having a content-addressed cache location.

## Decision

Locking publishes each prepared package under its canonical tree hash when its
object lock is available. Sync first validates the declared immutable source
identity, then verifies the matching prepared cache object in place before
using it for ownership planning or materialisation. A missing object is
prepared from the validated source, checked against the lockfile hash, and
atomically published when available.

Within one sync, a verified tree is reused for all selected packages with the
same package checksum. Repeated local declarations with the same immutable
identity and canonical manifest path share one source snapshot validation.
Cache integrity is never inferred from pathname or metadata alone.

## Consequences

Warm syncs retain full source and cache content verification, but avoid
source-to-staging copies and repeated cache verification for identical package
content. An actively locked cache object falls back to the verified staged
source tree rather than blocking a valid project transaction. A cache-hit
object retains its object lock through materialisation, so conservative cache
maintenance cannot delete it mid-transaction. Project mutation remains after
all source, cache, and ownership validation. No lockfile or cache-object
format changes.

## Alternatives considered

- Trust cache metadata or timestamps: rejected because a writable cache can be
  altered without updating metadata.
- Skip source validation on cache hit: rejected because local source drift must
  fail before project mutation.

## Migration and compatibility impact

No manifest, lockfile, cache-object, or installed-state format changes.
