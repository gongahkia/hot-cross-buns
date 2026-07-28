# ADR 0039: 1.0 compatibility policy

## Status

Accepted

## Context

A `1.0` declaration makes manifest and lockfile semantics a compatibility
commitment. Wukong must not convert source identities, layout selections, or
ownership state silently while attempting to preserve reproducibility.

## Decision

Before `1.0`, additive manifest and lockfile changes remain explicitly
schema-gated and old tools reject fields they do not understand. At `1.0`, a
supported 1.x tool must continue to read every released 1.x manifest and
lockfile schema, or emit a precise upgrade diagnostic before project mutation.

Any future breaking format change requires a new schema, ADR, migration guide,
and an explicit migration command. That command must stage its output,
preserve immutable source identities and checksums, create a recoverable
backup, validate the result, and publish atomically. It must never run package
scripts, fetch a new source, or materialise a project as a side effect of a
format migration.

## Consequences and alternatives considered

This policy favours readable old state over automatic conversion convenience.
It requires maintaining parsers or migration paths for released formats and
keeps format upgrades reviewable in source control.

Automatically rewriting a lock during `sync` was rejected because it can hide
a source or ownership change. Treating every additive field as an unversioned
extension was rejected because typos and divergent implementations weaken
deterministic behaviour.

## Migration and compatibility impact

No migration command is implemented yet because no released format requires
one. This policy is a release prerequisite, not evidence that 1.0 should be
released now.
