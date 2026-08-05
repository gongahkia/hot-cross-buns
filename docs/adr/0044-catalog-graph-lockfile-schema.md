# ADR 0044: catalog graph lockfile schema

## Status

Superseded by [ADR 0045](0045-catalog-graph-root-provenance.md).

## Context and constraints

The source catalog and resolver select an immutable dependency graph, not only
direct source declarations. Schema two cannot distinguish a catalog declaration
from a direct declaration, permits absent package versions, and does not require
dependency edges to form a complete graph. Catalog-selected content needs a
reviewable, credential-free representation before later lock, sync, and update
integration.

## Decision

Add schema three for catalog-selected graphs. New schema-three entries require:

- canonical package name and complete selected `version`;
- `catalog_sha256`: the lowercase SHA-256 fingerprint of the selected reviewed
  catalog declaration;
- one immutable Git or HTTPS source identity, source-relative selected root,
  target path, canonical package-tree SHA-256, and known Godot requirement;
- sorted dependency-edge names that all resolve to another lock entry; and
- existing deterministic fields needed for safe materialisation.

Schema-three serialization orders packages and dependency edges canonically and
never stores credentials, mutable selectors, scripts, host paths, or timestamps.
It rejects local sources, unknown package versions or Godot support, missing or
self-referential dependency edges, and malformed catalog fingerprints.

Schema one and schema two remain readable and serialize in their parsed schema.
Direct-only locking continues to create schema two until graph integration is
implemented. No automatic migration is performed; the later migration command
must explicitly preflight and publish a schema-three graph.

Direct-root provenance and runtime/development closure classification are not
schema-three admission requirements here; they are owned by #37 and #39.

## Consequences and alternatives considered

Schema three makes each catalog-derived package independently reviewable against
its source declaration while keeping resolver types source-neutral. A complete
edge set permits later graph consumers to reject partial or dangling state.

Retaining optional versions or a single whole-catalog hash was rejected because
neither identifies which reviewed declaration produced each selected package.
Changing schema two in place was rejected because existing readers could accept
incomplete graph state. Adding direct-root membership now was rejected because
the closure policy has not yet been decided.
