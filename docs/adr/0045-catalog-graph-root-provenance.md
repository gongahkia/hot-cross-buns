# ADR 0045: catalog graph root provenance

## Status

Accepted. Supersedes [ADR 0044](0044-catalog-graph-lockfile-schema.md) for
schema-three catalog graph locks.

## Context and constraints

Schema three recorded selected entries and edges but not the direct runtime and
development roots. Consumers therefore had to infer provenance from a mutable
manifest or an entry-level flag. That cannot distinguish a shared runtime and
development dependency from a development-only dependency.

No schema-three lockfiles have users at this decision point. The schema may be
corrected in place; schema one and schema two remain unchanged.

## Decision

Schema-three locks require a `[roots]` table with sorted, unique `runtime` and
`development` package-name arrays. Every root names a selected package, and
every selected package must be reachable from at least one root.

Runtime and development closure membership is derived from those roots. A
package reachable through both groups is runtime; `package.development` is
therefore true only for development-only closure members and is validated on
parse. Construction canonicalises that field before serialization.

`tree`, `why`, `audit`, and `status` use this persisted schema-three graph. The
tree and why commands do not need a manifest for schema-three locks. Legacy
tree and why retain manifest-derived roots, while legacy audit and status retain
their prior lockfile and installed-state views.

The schema number remains three because the unpublished format is deliberately
revised before catalog lock publication. Existing schema-three documents
without `[roots]` are rejected and must be regenerated. Direct-source locks
continue to write schema two.

## Consequences and alternatives considered

Root provenance makes review output stable across equivalent manifests and
supports deterministic shared-dependency promotion. Reconstructing schema-three
roots from incoming edges or the `development` flag was rejected because it
cannot preserve explicit root intent. Adding schema four was rejected because
it would preserve an incomplete unpublished schema without a compatibility
benefit.
