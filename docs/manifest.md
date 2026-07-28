# Manifest

`wukong.toml` is UTF-8 TOML. Version one permits only `[project]`,
`[dependencies]`, and `[dev-dependencies]` tables. Unknown fields are errors.

```toml
[project]
name = "my-game"
godot = ">=4.5,<5"

[dependencies]
example = { path = "../example-addon" }
```

`project.name` is a non-empty string. `project.godot` and version-only
dependencies use SemVer requirements. Dependency aliases are lowercase ASCII
letters, digits, and internal hyphens; they must begin and end with an
alphanumeric character.

Each dependency is either a version string or an inline table with exactly one
source:

```toml
[dependencies]
catalogue = "^1.2"
local = { path = "../local-addon" }
git-addon = { git = "https://example.test/addon", tag = "v1.2.0" }
archive = { url = "https://example.test/addon.zip", sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }
```

Local paths may be relative or absolute. Relative paths are resolved against
the manifest directory and lexically normalised; existence, symlink handling,
and content hashing are deferred to the local-path adapter. Git accepts HTTPS,
`ssh://`, and Git's `user@host:path` SSH form, with at most one of `rev`, `tag`,
or `branch`. `rev` must be a complete 40- or 64-character hexadecimal object
ID. Archive sources require a 64-character hexadecimal SHA-256 value.

HTTPS user information and sensitive query parameters are rejected. SSH user
names are allowed for standard Git remotes, but SSH passwords are rejected.
Manifests declare inputs only: `wukong` does not execute package scripts.

## Editing

The core manifest-edit API can add or remove runtime and development
dependencies. It validates the complete result before publishing it,
preserves untouched TOML comments and fields, and sorts the changed dependency
table lexicographically. New inline source fields use a fixed order.

Edits are staged and committed transactionally; see
[ADR 0003](adr/0003-manifest-edit-transaction.md). `wukong add` and
`wukong remove` are not exposed yet because their PRD semantics also require
resolution, lockfile updates, and package materialisation.
