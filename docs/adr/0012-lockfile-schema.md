# ADR 0012: lockfile schema

## Status

Accepted

## Context

The lockfile must make a resolved package graph reviewable and reproducible.
The current implementation supports only local-path source resolution, while
Git and HTTP adapters remain intentionally unimplemented.

## Decision

Use UTF-8 TOML in `wukong.lock`. Schema one has a mandatory top-level integer
`schema = 1` and sorted `[[package]]` entries. Each package records its
canonical `name`; optional resolved `version`; local source `kind`, immutable
identity, and source checksum; canonical package checksum; sorted resolved
dependency names; source subdirectory; target path; Godot requirement or the
literal `"unknown"`; and whether it is development-only.

All source and package checksums are lowercase SHA-256. A local source's
immutable ID is `sha256:<source checksum>`. `source_subdirectory = "."`
represents the source root. Timestamps, host paths, credentials, mutable branch
names, and executable commands are prohibited. Schema one defines `kind =
"local"` only. Git, HTTP, and official-source representations require later
source-adapter ADRs and schema evolution.

Unknown mandatory schema versions fail. The W041 parser must reject unknown
unprefixed fields and accept-and-preserve `x-` extension fields without giving
them package-manager semantics.

## Consequences

Schema-one locks are portable across machines when their local source contents
are available, without persisting machine-specific canonical paths. A local
dependency changing produces a different source identity and checksum. The
package checksum captures canonical W033 content independently of its source
snapshot.

## Alternatives considered

- JSON: rejected because TOML matches the manifest and is easier to review.
- A local absolute source path: rejected because it leaks machine-specific
  state and is not an immutable identity.
- Store mutable Git branches: rejected because a branch cannot reproduce a
  resolved source.
- Treat unknown Godot compatibility as `*`: rejected because unknown and
  universally compatible have different resolver semantics.

## Migration and compatibility impact

Any new source representation or changed field semantics requires a new schema
version and ADR. Schema-one readers must reject later mandatory versions rather
than silently misinterpreting them.
