# ADR 0001: manifest v1 schema

## Status

Accepted

## Context

`wukong` needs a human-editable project manifest that declares runtime and
development dependencies from local paths, Git repositories, HTTP archives, and
future version catalogues. The PRD specifies TOML provisionally and requires
unambiguous sources, secret-free persistence, and deterministic rewriting.

The initial local-path vertical slice needs a stable schema without committing
to package layout, resolution, or lockfile design.

## Decision

Use `wukong.toml` encoded as UTF-8 TOML. Version 1 accepts only these top-level
tables:

```toml
[project]
name = "my-game"
godot = ">=4.5,<5"

[dependencies]
example = { path = "../example" }

[dev-dependencies]
example-tools = { git = "https://example.test/tools", tag = "v1.0.0" }
```

`project.name` and `project.godot` are required strings. No manifest schema
version field is used in v1 so the PRD example remains valid; unrecognised
top-level and table fields are rejected instead.

Dependency aliases use lowercase ASCII letters, digits, and hyphens; they must
start and end with an alphanumeric character. This is a manifest-key rule, not
a final package-identity rule. Unicode aliases are rejected to avoid ambiguous
cross-platform and normalisation behaviour.

Each dependency value is either a version-requirement string or an inline table.
An inline table specifies exactly one source:

- `path = "relative-or-absolute-path"`
- `git = "https://..."`, with at most one of `rev`, `tag`, or `branch`
- `url = "https://..."` and required `sha256 = "..."`

Git branches are allowed only as manifest inputs; a later lockfile must resolve
them to commits. URL user information and sensitive query credentials are
rejected. Path interpretation and canonicalisation belong to manifest parsing.

`dependencies` and `dev-dependencies` use the same dependency grammar and stay
separate in domain data. Package layout, target mapping, and source subdirectory
fields are deferred to their dedicated roadmap issues.

Use `toml_edit` for parsing so future manifest edits can preserve comments and
source spans. Use `semver` for requirement validation; neither crate is used for
resolution.

## Consequences

The parser can reject unsupported fields early with field-specific diagnostics.
Existing PRD examples remain valid. The narrow source tables prevent accidental
mixing of source adapters and avoid persisting credentials.

Manifest rewriting must use deterministic key ordering but is deferred to
`wukong-014`. Package identity, case handling beyond manifest aliases, and
source-adapter resolution remain pending ADRs and implementation.

## Alternatives considered

- JSON or YAML: rejected because TOML is the PRD default and inline tables are
  readable for one-source declarations.
- A required manifest schema version: rejected for v1 because it would break the
  PRD example without providing a current compatibility benefit.
- Permissive unknown fields: rejected because they hide misspellings and weaken
  deterministic behaviour.
- A custom version parser: rejected in favour of `semver`.

## Migration and compatibility impact

Any new required manifest field or source-table field requires a new ADR and a
schema migration policy. Future manifest schema versioning must retain v1 input
support or provide an explicit migration command.
