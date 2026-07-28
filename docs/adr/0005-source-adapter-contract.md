# ADR 0005: source-adapter contract

## Status

Accepted

## Context

`wukong` needs local, Git, archive, and future source implementations without
embedding source-specific fields in resolution or installation logic. The
current scope is the local-path vertical slice; adding remote implementations is
explicitly deferred.

## Decision

Define a Rust `SourceAdapter` trait with associated request, resolution,
fetched-artifact, integrity-metadata, and layout-metadata types. The shared
methods cover canonical identity, version availability where supported,
immutable resolution, fetch, integrity metadata, layout metadata,
human-readable diagnostics through structured core errors, and offline
availability.

Only the canonical `SourceIdentity` and a source-neutral
`ImmutableSourceId` cross the adapter boundary. Source-specific request fields
remain in the adapter's associated request type. Version discovery may return
`Unsupported` for sources such as direct local paths.

## Consequences

Generic resolution can enforce deterministic identities without knowing source
protocol details. Each adapter owns its own authentication, URL handling, cache
interaction, and package-layout hints. Contract tests are deferred to
`wukong-026`; the local-path adapter implements this interface in `wukong-022`.

## Alternatives considered

- A shared source enum carrying Git and HTTP fields: rejected because it leaks
  protocol assumptions into generic resolution.
- Separate bespoke methods at each call site: rejected because it prevents
  reusable contract tests and consistent offline behaviour.
- A dynamic trait returning untyped values: rejected because source boundaries
  should be compile-time checked.

## Migration and compatibility impact

New source types add an adapter and associated types. Changing an existing
shared method requires a replacement ADR and contract-test migration.
