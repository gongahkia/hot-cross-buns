# ADR 0022: HTTP archive transport

## Status

Accepted

## Context

Archive sources need HTTPS transport, checksum verification, bounded streaming,
and cache publication without persisting URLs or credentials. The standard
library does not provide HTTPS or redirect handling.

## Decision

Use `ureq` 3.3.0 with default features disabled and the Rustls feature enabled.
It is MIT OR Apache-2.0 licensed and declares Rust 1.85 support. Rustls avoids
an OS TLS dependency while preserving certificate validation.

Permit HTTPS only, including every redirect target; follow at most five
redirects and reject HTTP downgrade, credentialed URLs, non-success responses,
and responses with a declared or streamed body above 256 MiB. Stream bytes into
a temporary cache sibling while computing SHA-256, then publish only if the
declared checksum matches. Downloads use `downloads/sha256/<checksum>` and do
not persist URLs, redirect destinations, timestamps, or credentials.

## Consequences

Archive source integrity does not depend on TLS alone. Failed, oversized, or
interrupted transfers leave no published download. Conditional requests remain
deferred because checksum-addressed immutable archives do not require them.

## Alternatives considered

- `reqwest`: rejected because synchronous archive download does not require its
  larger async runtime and dependency graph.
- Native TLS: rejected because it adds platform-specific TLS dependencies.
- Trust a `Content-Length` header alone: rejected because chunked or dishonest
  responses require an enforced streamed limit.
