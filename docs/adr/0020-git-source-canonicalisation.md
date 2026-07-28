# ADR 0020: Git source canonicalisation

## Status

Accepted

## Context

Git declarations must have stable source identities without leaking credentials
or changing the meaning of an SSH host alias. The standard library does not
provide a standards-compliant HTTPS URL parser. Resolving a mutable tag or
branch requires repository access and belongs with Git fetching in W024.

## Decision

Accept HTTPS URLs, `ssh://` URLs, and Git's `user@host:path` SSH form. HTTPS
identities are parsed with `url` 2.5.8 (MIT OR Apache-2.0, Rust 1.63) and
canonicalise the scheme, host, and default HTTPS port. The dependency is needed
for standards-compliant URL and IDNA handling that the standard library lacks.

SSH forms are validated but retain host spelling and path text. This preserves
the meaning of user SSH and Git host aliases. SSH passwords, HTTPS user info,
queries, and fragments are rejected. No authentication material is created,
stored, or handled by canonicalisation.

An exact `rev` is a complete 40- or 64-character hexadecimal Git object ID.
Tags and branches remain validated manifest selectors, not immutable source
identities. W024 resolves floating selectors to commits before any Git source
can enter a lockfile.

`GitSourceIdentity` identifies a canonical repository location only. It adds a
Git variant to the existing source identity model without changing the schema-
one local-only lockfile.

## Consequences

Equivalent ordinary HTTPS repository locations compare identically while SSH
configuration remains under the user's control. Invalid or credentialed input
produces redacted diagnostics. No network I/O, repository access, lockfile
representation, or Git authentication is introduced by this decision.

## Alternatives considered

- Hand-written HTTPS parsing: rejected because URL, percent-encoding, and IDNA
  edge cases are security-sensitive and the standard library lacks a parser.
- Canonicalising SSH host aliases or rewriting SCP-style paths: rejected because
  these transformations can alter user Git or SSH configuration semantics.
- Treating tags and branches as immutable revisions: rejected because they can
  move and cannot reproduce a lockfile entry.

## Migration and compatibility impact

Git lockfile representation requires a later schema ADR. Schema-one readers
continue to accept local sources only.
