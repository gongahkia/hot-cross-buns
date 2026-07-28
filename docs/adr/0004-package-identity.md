# ADR 0004: package identity

## Status

Accepted

## Context

Resolution, locking, ownership, and conflict detection need a single package
identity before source adapters are implemented. The first vertical slice is
limited to local paths, but the identity rule must make conflicts explicit
before any source is fetched or materialised.

## Decision

A package name is one or more lowercase ASCII letters, digits, or hyphens. It
must begin and end with an ASCII alphanumeric character. Names are already
canonical: they are never case-folded or Unicode-normalised. Unicode and
uppercase names are rejected.

A local source identity is the absolute, filesystem-canonical package path,
including resolved symlinks. A package identity is the pair of a package name
and a source identity. Until optional package metadata exists, a direct
dependency alias supplies the provisional package name.

A resolution may repeat an identical identity. Two non-identical source
identities using the same package name are a conflict and must fail before
fetching or filesystem mutation. Runtime and development status belongs to a
dependency edge, not package identity; the same package is not duplicated
because it appears in both sections.

Remote source identity variants are deferred to their adapters. They must
follow this same `name + immutable source identity` model and cannot alter the
local-path rule.

## Consequences

Identity collections use sorted names for deterministic diagnostics and future
persisted output. Local paths are host-filesystem identities and therefore are
not portable lockfile identities; local dependencies will record their content
snapshot separately in the local-path work.

## Alternatives considered

- Case-insensitive or Unicode-normalised names: rejected because cross-platform
  normalisation rules would be ambiguous.
- Alias-only identity: rejected because the same package could silently resolve
  from a different source.
- Treat development dependencies as distinct package instances: rejected
  because it duplicates cache, ownership, and conflict state.

## Migration and compatibility impact

Optional package metadata may replace a direct alias as the declared name only
when it matches or an explicit migration is provided. Future source adapters
add their canonical source variants without changing the package-name grammar.
