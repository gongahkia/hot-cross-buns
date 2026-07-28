# ADR 0016: installed-state schema

## Status

Accepted

## Context

Safe synchronisation and removal need durable proof of which project files
Wukong created. The state must remain portable, deterministic, and independent
of the terminal or local source paths.

## Decision

Use `.wukong/state.toml` with mandatory `schema = 1`. It records sorted
selected dependency groups; sorted installed package names with immutable source
identities and package-tree SHA-256 values; and sorted project-relative file
records with owner, content SHA-256, and per-file materialisation strategy.

Only `copy`, `hardlink`, and `reflink` strategy names are representable. State
paths must be slash-separated safe relative paths and may not enter `.wukong`.
Unknown fields, duplicate packages or paths, unsafe hashes, and files whose
owners are absent are rejected. The API can create a real `.wukong` directory
without overwriting another filesystem object; W055 owns transactional state
file publication as the final synchronisation step.

## Consequences

Later synchronisation can remove only files whose prior ownership is proven and
whose hash still matches. Schema changes require a new version and migration
policy. No timestamp, host path, credentials, or source URL is persisted.

## Alternatives considered

- Tracking only package roots: rejected because a package can share or lose
  individual files and removal must be precise.
- Unversioned JSON: rejected because TOML matches project metadata and a
  versioned document prevents silent reinterpretation.
- One global materialisation strategy: rejected because a sync may fall back
  from a link strategy for individual files.

## Migration and compatibility impact

Schema-one readers reject later schemas. Existing projects with no state file
are treated as having no proven package-owned files.
