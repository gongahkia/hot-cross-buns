# Cache layout

Wukong uses the platform cache directory, or `WUKONG_CACHE_DIR` when set. Its
schema-one root is `wukong/v1/`, partitioned into `downloads`, `checkouts`,
`packages`, `metadata`, and `locks`.

Prepared packages are content-addressed at `packages/sha256/<digest>`. The
matching process lock is `locks/sha256/<digest>.lock`. Cache paths never store
credentials, source URLs, timestamps, or host-specific source paths. See
[ADR 0013](adr/0013-cache-layout.md).

Publication stages a canonical tree in a unique object-specific sibling
directory, flushes it, then atomically renames and re-verifies the final object.
An active object lock fails fast with a retry diagnostic. Once released, a
later publication verifies and reuses the object; mismatched content returns an
integrity error. Stale object-specific staging is cleaned only while holding
that object's lock; empty persistent lock files are safe. See
[ADR 0014](adr/0014-cache-publication.md) and
[ADR 0030](adr/0030-advisory-operation-locks.md).

The prepared-package cache-read API re-hashes a canonical tree against the
object's SHA-256 directory name. A mismatching object is cache-owned, removed,
and reported as an integrity failure. `wukong cache verify` checks all prepared
objects in deterministic order, reports verified and removed-corrupt counts,
and exits with code 4 if it repaired corruption. Unrecognized entries are
never deleted. See [ADR 0015](adr/0015-cache-integrity-verification.md).

Git checkouts use `checkouts/git/sha256/<digest>`, where the digest derives from
a canonical source identity and immutable commit. Selector-to-commit metadata
uses hashed names below `metadata/git/sha256`; Git source URLs and credentials
are never persisted. Offline synchronisation can reuse a verified locked-commit
checkout without selector metadata, while mutable selectors still require that
mapping. See [Git fetching](git-fetching.md) and
[ADR 0029](adr/0029-strict-offline-mode.md).

Git version discovery caches only a fixed schema header plus sorted
`version -> commit` rows below `metadata/git-versions/sha256/<digest>`. The
digest includes the canonical source and configured tag prefix. Online
discovery refreshes this metadata; offline discovery rejects missing or invalid
metadata rather than selecting an unverified version. See
[ADR 0026](adr/0026-git-version-discovery.md).

HTTP archives use `downloads/sha256/<checksum>`, keyed solely by their declared
lowercase SHA-256. The source URL, redirect destinations, timestamps, and
credentials are never persisted. Every cache reuse re-hashes the archive before
it is returned. See [HTTP archives](http-archives.md).

## Maintenance

`wukong cache dir` prints the active schema root. `wukong cache status` reports
recognized prepared-package/archive counts plus binary human-readable byte
sizes; its recursive size scan does not follow symlinks.

`wukong cache clean --dry-run` reports deterministic cleanup candidates without
mutation. Without `--dry-run`, `wukong cache clean` acquires every candidate's
lock before deleting recognized prepared-package objects and checksum-addressed
HTTP archives. It preserves lock files, unrecognized entries, Git checkouts,
and metadata because their matching lock identities cannot yet be proven. See
[ADR 0031](adr/0031-conservative-cache-maintenance.md).
