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
