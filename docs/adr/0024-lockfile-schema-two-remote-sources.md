# ADR 0024: Lockfile schema two remote sources

## Status

Superseded by [ADR 0044](0044-catalog-graph-lockfile-schema.md).

## Context

Schema one records only local snapshots. Direct Git and HTTP dependencies need
enough source location data to reacquire content while recording only immutable
identities. A Git branch or tag cannot be the lock identity, and a URL archive
cannot rely on TLS instead of its checksum.

## Decision

Write new lockfiles as schema two and continue to parse schema one local-only
locks. Schema two retains all package fields and adds these source forms:

- `local`: immutable ID and source-tree SHA-256, unchanged from schema one.
- `git`: canonical credential-free URL, complete resolved commit, and
  `git:<commit>` immutable ID.
- `http`: canonical credential-free HTTPS URL, archive SHA-256, and
  `sha256:<checksum>` immutable ID.

Every source URL is validated on parsing and canonicalised before writing.
Credentials, fragments, unsafe query parameters, mutable Git selectors,
timestamps, and executable commands remain prohibited. Schema-one locks retain
their original schema and bytes when parsed and serialized; new remote lock
representations require schema two.

## Consequences

Existing local lockfiles remain readable. A lock update writes schema two even
for local-only manifests. Direct locking can reuse an unchanged existing lock
without source access; a changed Git declaration resolves to a complete commit,
and an HTTP declaration verifies its declared checksum before lock publication.

## Alternatives considered

- Change schema one in place: rejected because existing readers could
  misinterpret remote fields.
- Store a Git tag or branch in the lock: rejected because it is mutable.
- Omit remote URLs from the lock: rejected because the immutable identity alone
  cannot reacquire a missing cache object.
