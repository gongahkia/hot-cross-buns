# ADR 0032: Credential handling

## Status

Accepted

## Context

Source declarations, lockfiles, transport failures, Git failures, and user
supplied diagnostics can contain credentials. Wukong must support private
sources without recording or displaying their authentication material.

## Decision

Reject source URLs containing user information or sensitive query parameters,
including percent-encoded parameter names. Lockfile constructors and parsing
apply the same source validation, so credentials cannot enter persisted source
records.

All `Diagnostic` text is redacted before retention. Redaction covers URL user
information, sensitive query values, and common HTTP authentication/cookie
headers. The HTTP archive client exposes no user-configurable request headers
and does not log request or response headers.

Git authentication remains entirely with the user-installed Git executable,
its credential helpers, and SSH configuration. Wukong invokes Git with an
argument vector, does not invoke a shell, install credential callbacks, set
authentication environment variables, or capture Git stderr into diagnostics.

## Consequences

Private Git and archive access must be configured outside manifests and
lockfiles. Diagnostics retain enough source identity to identify a host and
path while replacing secret values. The CLI has no telemetry or crash-report
upload path; vulnerability reports must use redacted reproductions.

## Alternatives considered

- Persist encrypted credentials: rejected because encryption-key handling and
  accidental disclosure add risk without improving reproducible identities.
- Pass authentication headers through manifest fields: rejected because these
  fields would be easy to commit, cache, or print.
- Implement Git credential callbacks: rejected because Git credential helpers
  and SSH configuration already provide the user-controlled mechanism.

## Migration and compatibility impact

No persisted schema changes. Existing credential-bearing manifests or
lockfiles are rejected and must move authentication to external Git, SSH, or
network configuration.
