# ADR 0029: strict offline mode

## Status

Accepted

## Context

`--offline` must make dependency operations reproducible without contacting a
remote source. A single missing artifact must not conceal later missing
artifacts, and an immutable Git lock already identifies its checkout without a
mutable selector mapping.

## Decision

Offline Git acquisition first accepts a verified checkout addressed by the
canonical repository and the lockfile's complete commit. It does not require
selector metadata. Non-exact Git selectors and version discovery still require
their respective verified cached metadata.

Before offline synchronisation prepares any package or mutates the project,
Wukong checks every selected locked remote source. It returns one deterministic
diagnostic listing all unavailable Git checkout and HTTPS archive cache
artifacts. Cache-integrity failures remain integrity diagnostics rather than
being reported as missing content.

Offline HTTP acquisition returns a verified checksum-addressed archive before
constructing an HTTP client. Offline Git acquisition returns a verified cached
checkout before invoking Git. Local-path sources remain local filesystem
operations. No package scripts are executed.

## Consequences

A complete immutable checkout/archive cache is enough to materialise a locked
project offline. Error output names package aliases and immutable cache
identities, never cache paths, credentials, or mutable source references.
Preflight adds verified cache reads before the normal preparation pass.

## Alternatives considered

- Stop at the first unavailable source: rejected because users cannot prepare a
  complete offline cache from one actionable report.
- Require Git selector metadata for an exact locked commit: rejected because
  that mutable-resolution cache is unnecessary for an immutable install.
- Rely on a process-wide network firewall: rejected because it is
  platform-specific and does not protect library callers.

## Migration and compatibility impact

No manifest, lockfile, or cache-object format changes. Existing verified Git
checkouts become usable by offline synchronisation even if their selector
metadata is absent.
