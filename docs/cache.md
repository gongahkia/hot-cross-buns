# Cache layout

Wukong uses the platform cache directory, or `WUKONG_CACHE_DIR` when set. Its
schema-one root is `wukong/v1/`, partitioned into `downloads`, `checkouts`,
`packages`, `metadata`, and `locks`.

Prepared packages are content-addressed at `packages/sha256/<digest>`. The
matching process lock is `locks/sha256/<digest>.lock`. Cache paths never store
credentials, source URLs, timestamps, or host-specific source paths. See
[ADR 0013](adr/0013-cache-layout.md).
