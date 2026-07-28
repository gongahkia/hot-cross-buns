# ADR 0035: JSON metadata decoding

## Status

Accepted

## Context

The feature-gated AssetLib client consumes untrusted JSON metadata. The Rust standard library has no JSON parser. Implementing one would expand the attack surface and leave format compatibility to Wukong.

## Decision

Use optional `serde_json` for the `asset-library` feature only. Decode into `serde_json::Value` and validate every field at the adapter boundary; no untrusted JSON struct is deserialized directly into a lockfile or domain type.

`serde_json` is maintained, pure Rust, and dual-licensed MIT or Apache-2.0, which is compatible with Wukong's MIT distribution. It adds no native runtime dependency and is absent from default builds.

## Consequences

Default builds do not contain the adapter or JSON parser. Feature builds gain a narrow, tested parser while generic resolver and lockfile types remain free of AssetLib fields.

## Alternatives considered

- Write a custom JSON parser: rejected for security and maintenance cost.
- Parse fields with string matching: rejected because escaping and nested JSON make it unsafe and incorrect.

## Migration and compatibility impact

No persisted schema changes occur. The optional feature only adds support for the manifest `asset` declaration.
