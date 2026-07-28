# Architecture

## Status

This is the initial architecture baseline. It describes intended boundaries,
not implemented package-management behaviour. Format, identity, transaction,
and source-adapter decisions require ADRs before implementation.

## Workspace

```text
wukong
├── crates/wukong-core
│   └── reusable domain and filesystem logic
└── crates/wukong-cli
    └── command parsing and presentation
```

`wukong-core` must not depend on terminal rendering. The CLI calls core services
and converts their results into human or machine-readable output.

## Planned core boundaries

| Area | Responsibility |
| --- | --- |
| Project discovery | Locate and validate a Godot project. |
| Manifest and lockfile | Parse, validate, and deterministically serialise project state. |
| Package identity and sources | Canonicalise identities and resolve immutable source content. |
| Resolver | Lazily select a deterministic, compatible transitive package graph. |
| Preparation and cache | Verify source content and produce canonical package trees. |
| Ownership and materialisation | Detect conflicts and reconcile only proven package-owned files. |
| Transactions | Stage, verify, commit, and recover filesystem changes. |
| Diagnostics | Return structured, contextual errors without exposing secrets. |

## Planned synchronisation flow

```text
manifest + lockfile
        ↓
resolve desired package trees
        ↓
validate ownership conflicts
        ↓
stage and verify files
        ↓
commit project changes
        ↓
write installed-state metadata
```

Fetching, validation, and package preparation must finish before project files
are mutated. Failed operations should preserve the preceding valid state where
practical.

## Invariants

- Persisted output has deterministic ordering.
- No package scripts are executed.
- Package-owned files are not overwritten or deleted without proof of ownership.
- Lockfiles record immutable source identities.
- Source-specific details remain inside source adapters.

## Decision records

Use [ADRs](adr/README.md) for consequential decisions, including manifest and
lockfile formats, package identity, source-adapter contracts, cache keys,
transactions, solver choice, Git strategy, security policy, and cross-platform
support policy.
