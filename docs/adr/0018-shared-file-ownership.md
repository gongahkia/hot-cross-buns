# ADR 0018: shared installed-file ownership

## Status

Accepted

## Context

ADR 0017 permits exact identical files to be shared by multiple packages. A
single owner in installed state would allow removal of one package to delete a
file still required by another.

## Decision

Replace schema-one `file.package` with a non-empty, sorted `file.packages`
array. Every owner must appear in the installed package set. This supersedes
the singular-owner portion of ADR 0016 before any release of the schema.

## Consequences

State continues to be deterministic and safe removal can retain shared files
until all owners are absent. Readers of the unreleased singular-owner draft are
rejected and must regenerate state with `wukong sync`.
