# Lockfile schema

`wukong.lock` is UTF-8 TOML and machine-generated. Direct-source locks use
schema two. Schema-three catalog graphs require a complete immutable selection;
schema-one local-only and schema-two locks remain readable and retain their
original serialization. All package fields are deterministic and source-specific
fields are limited to safe canonical acquisition data plus immutable identities.

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

## Schema three catalog graphs

Schema three is the catalog-selected graph format. Each entry requires a
complete selected version, a per-package `catalog_sha256` fingerprint for the
reviewed catalog declaration, a Git or HTTPS immutable source, a known Godot
requirement, source layout, target layout, and closed dependency edges.

```toml
schema = 3

[roots]
runtime = ["example-addon"]
development = []

[[package]]
name = "example-addon"
version = "1.2.3"
catalog_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
dependencies = ["other-addon"]
source_subdirectory = "addons/example-addon"
target_path = "addons/example-addon"
godot = ">=4.4,<5"
development = false
package_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
declaration_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

[package.source]
kind = "git"
immutable_id = "git:4ab90a80b815bc1ad4a8d7eea92c785e654bfd91"
url = "https://github.com/example/addon.git"
commit = "4ab90a80b815bc1ad4a8d7eea92c785e654bfd91"
```

Schema-three roots are sorted direct package names. Every selected package must
be reachable from at least one root. Runtime and development closure membership
is derived from those roots; a shared member is runtime, and
`package.development` is true only for development-only members. Schema-three
entries reject local sources, unknown versions or Godot support, missing catalog
fingerprints, missing or unknown roots, stale development state, self-references,
and dangling dependency edges. No automatic conversion is performed. See
[ADR 0045](adr/0045-catalog-graph-root-provenance.md).

Package entries and their dependency lists are sorted. No timestamps, host
paths, credentials, mutable references, or executable commands are permitted.
`source_subdirectory` and `target_path` are the exact selected layout; they
change when the manifest's `root` or `target` override changes. They are part
of the declaration fingerprint and cannot be silently reused from a prior
lock.
`x-` fields are reserved for preserved extensions; unknown unprefixed fields
are errors. Parsing and re-serializing a valid schema-one or schema-two lock
produces stable canonical bytes. Schema two supports `local`, `git`, and
`http`; official sources are not represented.

## Command

`wukong lock` resolves direct local, Git, and HTTPS archive dependencies into
schema two, or resolves version-only roots through `wukong.sources.toml` into a
schema-three complete graph. Mixed catalog and direct-source declarations are
rejected. Locking does not materialise project files. Independent direct-source
preparation uses up to four workers, while lockfile ordering and the first
reported package error remain deterministic. `--offline` uses only verified
cached Git checkouts and HTTP archives; an exact Git revision can reuse its
checkout without selector metadata. When re-resolution is required, it lists
every unavailable remote artifact. `--locked` refuses a missing or changed
lockfile with exit code 2. An unchanged valid lockfile is not rewritten.
[`wukong install` and `wukong sync`](sync.md) apply both supported lock shapes
transactionally. [`wukong tree` and `wukong why`](dependency-views.md) read
this lockfile without resolving, fetching, or modifying project files.
[`wukong update`](update.md) refreshes both direct-source locks and
schema-three catalog root closures. [`wukong migrate`](migrate.md) converts a
preflighted lossless direct remote lock into catalog graph state.

## Policy

Commit `wukong.lock` with `wukong.toml`. Treat it as the reviewed desired state:
normal sync verifies it, `--locked` refuses declaration or source drift, and
`--frozen` additionally prohibits network access. Do not hand edit source
identities, checksums, ownership data, or schema fields. Regenerate a lock with
`wukong lock` after an intentional manifest change, then review the deterministic
diff before synchronising it.
