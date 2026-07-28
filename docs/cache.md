# Cache layout

Wukong uses the platform cache directory, or `WUKONG_CACHE_DIR` when set. Its
schema-one root is `wukong/v1/`, partitioned into `downloads`, `checkouts`,
`packages`, `metadata`, and `locks`.

Prepared packages are content-addressed at `packages/sha256/<digest>`. The
matching process lock is `locks/sha256/<digest>.lock`. Cache paths never store
credentials, source URLs, timestamps, or host-specific source paths. See
[ADR 0013](adr/0013-cache-layout.md).

Publication stages a canonical tree in a unique sibling directory, flushes it,
then atomically renames and re-verifies the final object. A concurrently
published object is verified and reused; mismatched content returns an
integrity error. See [ADR 0014](adr/0014-cache-publication.md).

The prepared-package cache-read API re-hashes a canonical tree against the
object's SHA-256 directory name. A mismatching object is cache-owned, removed,
and reported as an integrity failure. `wukong cache verify` checks all prepared
objects in deterministic order, reports verified and removed-corrupt counts,
and exits with code 4 if it repaired corruption. Unrecognized entries are
never deleted. See [ADR 0015](adr/0015-cache-integrity-verification.md).

Git checkouts use `checkouts/git/sha256/<digest>`, where the digest derives from
a canonical source identity and immutable commit. Selector-to-commit metadata
uses hashed names below `metadata/git/sha256`; Git source URLs and credentials
are never persisted. See [Git fetching](git-fetching.md).
