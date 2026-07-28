# ADR 0023: Source-adapter cancellation

## Status

Accepted

## Context

Source resolution and fetching may traverse large local trees or perform remote
I/O. The source-adapter contract did not expose cancellation, so callers could
not stop work consistently or test cleanup behaviour.

## Decision

Add a cloneable `CancellationToken` to the `resolve` and `fetch` methods of
`SourceAdapter`. A cancelled operation returns a structured source diagnostic.
Adapters must check it before work and at practical interruption points; any
adapter-owned staging state must be cleaned before returning cancellation.

The token is deliberately source-neutral and uses only shared atomic state. It
does not expose terminal, signal, async-runtime, or source-protocol details.
Callers that do not yet offer cancellation create a fresh token.

## Consequences

The local-path adapter checks cancellation while traversing directories and
hashing files. Future Git and HTTP adapters can use the same token during
network and staging work. Contract tests can verify cancellation without
depending on a particular concurrency runtime.

## Alternatives considered

- Add a global cancellation flag: rejected because operations must be isolated.
- Add async traits: rejected because the current core is synchronous and does
  not need a runtime to support cooperative cancellation.
- Leave cancellation adapter-specific: rejected because shared contract tests
  could not assert it.
