# Package metadata

Every package included in `wukong.lock` requires a valid UTF-8
`wukong-package.toml`. A missing or invalid file stops locking before cache,
lockfile, installed-state, or project mutation. Its canonical `package.name`
must equal the direct declaration or catalog package identity.

Addon authors can create a validating schema-one file with
[`wukong package init`](package-init.md); it never replaces existing metadata.
[`wukong package validate`](package-validate.md) verifies an existing file
without project mutation, cache access, source fetching, or network I/O.

It is required when validating a selected Git source-catalog candidate before
lock publication. Its canonical `package.version` must agree with the selected
Git tag version; SemVer build metadata does not affect that comparison.

It is also required for an HTTPS source-catalog candidate before admission. Its
`package.name` and canonical `package.version` must agree with the project
catalog declaration.

Schema one requires:

```toml
[package]
schema = 1
name = "example-addon"
version = "1.2.3"
godot = ">=4.4,<5"
root = "addons/example-addon"
target = "addons/example-addon"

[dependencies]
other-addon = "^2"
```

`root` and `target` must be safe relative paths. Dependencies use canonical
names and the [versioning policy](versioning.md). Metadata cannot declare sources or
scripts. See [ADR 0043](adr/0043-strict-package-metadata-policy.md). Known package
Godot requirements are validated before lockfile or project mutation; see
[Godot compatibility enforcement](godot-compatibility-enforcement.md).
