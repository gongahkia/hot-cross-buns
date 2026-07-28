# ADR 0025: Dependency resolver strategy

## Status

Accepted

## Context

The resolver must produce a deterministic complete dependency graph from
package metadata, source-provided versions, Godot compatibility constraints,
and an existing lockfile. It must report an unsatisfiable set of constraints
with its dependency path, prefer an existing valid lock selection, and allow
cancellation. A source-pinned local, Git-commit, or checksummed HTTP package
has one immutable candidate and no version catalogue.

The workspace supports Rust 1.85. Current `pubgrub` 0.4.0 and
`astral-pubgrub` 0.6.0 declare Rust 1.92. Upstream `pubgrub` 0.3.0 does not
declare an MSRV but compiled with Rust 1.85.0 on 2026-07-29. Its
`DependencyProvider` API supplies available versions and dependencies,
provides a cancellation hook, and returns a derivation tree for no-solution
diagnostics. It is MPL-2.0 and needs its required notices in distribution
material when it is added.

## Decision

Use these resolution semantics:

- Versions use the Rust `semver` crate's Cargo-compatible syntax: exact,
  comparator ranges, caret, and tilde requirements. Pre-release candidates
  require an explicitly matching pre-release requirement. Build metadata does
  not affect precedence.
- The versioned resolver input is a source-qualified package identity, a
  canonical SemVer requirement, package metadata, Godot compatibility
  requirements, and an ordered set of locked selections. Source adapters alone
  provide candidate versions and immutable source revisions.
- A valid locked version is selected before another candidate; otherwise the
  highest compatible non-pre-release version is preferred. Ties are ordered by
  canonical package identity and immutable source identity.
- A source-pinned dependency is an exact candidate. It is traversed for
  package metadata, source identity conflicts, and cycles, but never treated as
  a version catalogue or silently substituted with a different source.

Implement the versioned resolver in wukong-063 with `pubgrub = "=0.3.0"`.
Keep the PubGrub adapter behind a core resolver boundary. The adapter converts
the approved SemVer requirement semantics to `pubgrub` ranges, passes the
existing cancellation token through `should_cancel`, and formats derivation
trees using Wukong package identities. Do not write a custom version solver.

The `resolver_baseline` benchmark measures a deterministic 1,024-package
source-pinned traversal before the versioned adapter exists. It establishes the
fixture and command shape only; it makes no performance claim and does not
implement a version solver.

## Consequences

W061 owns the SemVer parser and policy tests. W062 owns source-specific version
discovery. W063 owns the PubGrub dependency, provider adapter, graph traversal,
lock preference, and diagnostic conversion. W064 owns generated solver tests.
Current direct local, Git, and HTTP locking remains unchanged because it has no
transitive resolution yet.

The candidate library's published MSRV must be revalidated on all supported
platforms when it is added. The dependency's MPL-2.0 notice must be included
in release attribution before distribution.

## Alternatives considered

- `pubgrub` 0.4.0: rejected for now because its declared Rust 1.92 MSRV exceeds
  the workspace MSRV.
- `astral-pubgrub` 0.6.0: rejected for now for the same Rust 1.92 MSRV.
- A bespoke backtracking solver: rejected because a maintained PubGrub
  implementation provides conflict derivations and cancellation without
  reimplementing solver correctness.
- Treat source-pinned dependencies as a version universe: rejected because an
  immutable source exposes exactly one candidate.
