# ADR 0042: project source catalog

## Status

Accepted

## Context

Wukong resolves package metadata by canonical name and semantic-version
requirement. Package metadata deliberately contains no source-specific fields,
and Wukong will not add a hosted registry. A transitive dependency therefore
needs project-owned, reviewed source-location data before it can be resolved.

Direct path, Git, and HTTPS archive declarations already support local
workflows. Local paths are not portable across team machines, while mutable Git
selectors must not become lockfile identities. The catalog must keep those
constraints intact without leaking Git or HTTP fields into generic resolution.

## Decision

Add a committed `wukong.sources.toml` beside `wukong.toml`.

- The catalog is schema-versioned, parsed and serialized deterministically,
  and contains only project-owned source-location declarations.
- A Git entry identifies one package, a canonical Git URL, a safe
  source-relative root, and an optional tag prefix. Candidate versions are
  discovered from matching semantic-version tags and lock to complete commits.
- An HTTPS archive candidate explicitly records its package name, version,
  credential-free URL, SHA-256, and safe source-relative root.
- Every selected candidate must contain valid `wukong-package.toml`; its name
  and version must agree with the candidate before lockfile publication.
- A same-name/version selection available from distinct source identities is a
  user error. Exact duplicate identities are one deterministic candidate.
- Local paths remain direct development-only declarations. They cannot appear
  in the catalog or a transitive graph.
- Generic resolver types receive source-neutral candidates and immutable IDs.
  Git and HTTPS acquisition remains inside their source adapters.

The manifest retains explicit direct path, Git, and HTTPS declarations. A
version-only direct dependency resolves through the catalog; all transitive
dependencies resolve through it. Catalog edits are transactional and can be
performed by CLI commands or strict manual TOML edits.

## Consequences

Schema three lockfiles will need catalog declaration fingerprints, immutable
candidate source identities, selected versions, and complete graph edges.
`lock` preserves a valid selection; `update` refreshes a selected direct root's
reachable closure or all roots when omitted. `sync --frozen` reads only the
lockfile and verified cache and never contacts the catalog sources.

The catalog does not provide publisher identity, signatures, a global index,
or a user-scoped source configuration. AssetLib remains experimental and does
not become a catalog source. Existing projects move through an explicit,
previewable migration; automatic migration during lock or sync is rejected.

## Alternatives considered

- Sources inside package metadata: rejected because generic dependency
  metadata would expose source-specific resolver logic and transitively trust
  package-authored locations without project review.
- A hosted Wukong registry: rejected by product scope and because it creates a
  service availability and trust boundary.
- User-scoped catalog: rejected because it makes team resolution depend on
  machine state outside version control.
- Git-only transitive dependencies: rejected because verified HTTPS archives
  are already supported immutable sources.

## Migration and compatibility impact

`wukong.sources.toml` is a new committed project file. Its schema, manifest
version-only dependencies, strict metadata requirement, and schema-three lock
output require an explicit migration command that preflights and rolls back all
project-state changes. Legacy direct source declarations remain readable until
the migration policy is implemented.
