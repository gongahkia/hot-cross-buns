# Lockfile schema

`wukong.lock` is UTF-8 TOML and machine-generated. New lockfiles use schema
two; schema-one local-only locks remain readable and retain their original
serialization. All package fields are deterministic and source-specific fields
are limited to safe canonical acquisition data plus immutable identities.

```toml
schema = 2

[[package]]
name = "example-addon"
version = "1.2.3" # omitted when package metadata has no version
dependencies = ["other-addon"]
source_subdirectory = "."
target_path = "addons/example-addon"
godot = ">=4.4,<5" # or "unknown"
development = false
package_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
declaration_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

[package.source]
kind = "local"
immutable_id = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Git sources record a credential-free canonical URL and complete commit:

```toml
[package.source]
kind = "git"
immutable_id = "git:4ab90a80b815bc1ad4a8d7eea92c785e654bfd91"
url = "https://github.com/example/addon.git"
commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91"
```

HTTP sources record a credential-free canonical HTTPS URL and required archive
checksum:

```toml
[package.source]
kind = "http"
immutable_id = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
url = "https://example.test/addon.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Package entries and their dependency lists are sorted. No timestamps, host
paths, credentials, mutable references, or executable commands are permitted.
`x-` fields are reserved for preserved extensions; unknown unprefixed fields
are errors. Parsing and re-serializing a valid schema-one lock produces stable
canonical bytes. Schema two supports `local`, `git`, and `http`; official
sources are not represented. See [ADR 0024](adr/0024-lockfile-schema-two-remote-sources.md).

## Command

`wukong lock` resolves direct local, Git, and HTTPS archive dependencies and
writes `wukong.lock`; it does not materialise project files. `--offline` uses
only verified cached Git checkouts and HTTP archives; an exact Git revision can
reuse its checkout without selector metadata. When re-resolution is required,
it lists every unavailable remote artifact. `--locked` refuses a
missing or changed lockfile with exit code 2. An unchanged valid lockfile is not
rewritten. [`wukong install` and `wukong sync`](sync.md) apply supported direct
source locks transactionally. [`wukong tree` and `wukong why`](dependency-views.md)
read this lockfile without resolving, fetching, or modifying project files.
[`wukong update`](update.md) re-locks all direct dependencies or one selected
entry, prints immutable source or version changes, and synchronises the result
transactionally.
