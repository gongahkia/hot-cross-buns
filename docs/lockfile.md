# Lockfile schema

`wukong.lock` is UTF-8 TOML and machine-generated. Schema one records only the
implemented local-path source form:

```toml
schema = 1

[[package]]
name = "example-addon"
version = "1.2.3" # omitted when package metadata has no version
dependencies = ["other-addon"]
source_subdirectory = "."
target_path = "addons/example-addon"
godot = ">=4.4,<5" # or "unknown"
development = false
package_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

[package.source]
kind = "local"
immutable_id = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Package entries and their dependency lists are sorted. No timestamps, host
paths, credentials, mutable references, or executable commands are permitted.
`x-` fields are reserved for preserved extensions; unknown unprefixed fields
are errors. Parsing and re-serializing a valid schema-one lock produces stable
canonical bytes. Git, HTTP, and official sources are not represented until
their adapters exist. See [ADR 0012](adr/0012-lockfile-schema.md).
