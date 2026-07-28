# Architecture decision records

ADRs capture consequential, durable technical decisions.

## When to write an ADR

Create one before changing manifest or lockfile formats, package identity,
source-adapter interfaces, cache keys, filesystem transactions, dependency
solving, Git strategy, security policy, or cross-platform support policy.

## Format

Name records `NNNN-short-title.md`, using the next four-digit sequence. Each
record must contain:

1. Status: proposed, accepted, superseded, or rejected.
2. Context and constraints.
3. Decision.
4. Consequences and alternatives considered.
5. Migration or compatibility impact, when relevant.

ADRs are immutable after acceptance except for status transitions or factual
corrections. A replacement ADR must link to the decision it supersedes.
