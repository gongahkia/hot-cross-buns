# ADR 0009: optional package metadata schema

## Status

Superseded by [ADR 0043](0043-strict-package-metadata-policy.md).

## Context

Packages need optional self-description without making direct local installation
depend on metadata adoption.

## Decision

Use optional UTF-8 `wukong-package.toml`. When present it requires `[package]`
with `schema = 1`, canonical `name`, semantic `version`, Godot requirement
`godot`, and optional safe relative `root` and `target`. `[dependencies]` maps
canonical names to semantic version requirements. Unknown fields are rejected.

Metadata is never required for direct package installation. Without it, the
manifest alias and W031 layout detection remain authoritative. Metadata cannot
declare sources or scripts.

## Consequences

Future schemas use explicit dispatch. Root and target are layout metadata only.
Transitive resolution can consume dependencies without source-specific fields.

## Alternatives considered

- Require metadata: rejected because existing addons remain installable.
- Reuse `wukong.toml`: rejected because project and package ownership differ.
- Permit unknown fields: rejected because misspellings weaken reproducibility.

## Migration and compatibility impact

Schema 1 parsers reject unknown schema versions. Future versions require a new
ADR and explicit compatibility or migration policy.
