# ADR 0043: strict package metadata policy

## Status

Accepted. Supersedes [ADR 0009](0009-package-metadata-schema.md).

## Context and constraints

Transitive resolution needs package-authored identity, version, Godot support,
and source-neutral dependency requirements. Optional metadata leaves a locked
package without a verified name, version, compatibility declaration, or
transitive dependency contract. Catalog candidates already require metadata,
but direct sources must follow the same boundary before graph locking begins.

Package metadata is package-authored and source locations are project-owned.
The metadata boundary must therefore not admit Git URLs, archive URLs, local
paths, checksums, credentials, scripts, or source-adapter fields.

## Decision

Every package included in a lockfile must contain a valid schema-one UTF-8
`wukong-package.toml`. Metadata absence, invalid schema, identity mismatch,
version mismatch, or incompatible Godot requirement is a user error before
lockfile, cache, installed-state, or project mutation.

The metadata `package.name` must equal the resolved package identity. Its
`package.version` must equal the selected catalog version when one is present,
and becomes the locked version for direct immutable sources. The mandatory
`package.godot` requirement is validated against the project's declared range
and, when supplied, the exact `--godot` engine version. Known incompatibility
blocks the operation; pre-release ambiguity requires exact engine input.

`[dependencies]` remains a deterministic map of canonical package names to
semantic-version requirements. It contains no source declarations. Project
`wukong.sources.toml` supplies reviewed Git or HTTPS locations for all versioned
and transitive candidates. Local paths remain direct development-only manifest
declarations and cannot occur in package metadata or transitive graphs.

## Consequences and alternatives considered

All packages gain a uniform identity and compatibility contract before graph
resolution and lock generation. Package authors must provide metadata even for
direct local development packages. This makes incomplete third-party addons
ineligible until metadata is added.

Keeping metadata optional was rejected because it creates an unverifiable
exception at the resolver boundary. Putting source declarations in metadata
was rejected because package authors must not select project sources or leak
source-specific fields into generic resolution. Inferring a version from Git
tags, directory names, or Godot files was rejected because it is ambiguous and
cannot provide a complete package contract.

## Migration and compatibility impact

This pre-alpha repository has no compatibility obligation for metadata-less
locks. Existing projects must add valid metadata before they can create or
refresh a lock under this policy. No automatic migration is permitted:
`wukong package init` and `wukong package validate` provide explicit authoring
and validation workflows, while a future catalog-and-lock migration must be
transactional and reviewable.

Implementation is owned by #32; catalog, package, and lock agreement is
extended by #35. This decision replaces only ADR 0009's optionality; ADR 0042
continues to govern project-owned catalog sources.
