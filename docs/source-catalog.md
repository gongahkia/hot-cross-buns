# Source catalog

`wukong.sources.toml` is a committed UTF-8 TOML catalog of project-reviewed
package source locations. It does not fetch sources while parsing and it is not
a hosted registry or user-scoped configuration.

Schema one uses a required `schema` value and one `[[package]]` candidate per
declared source:

```toml
schema = 1

[[package]]
name = "terrain3d"
[package.git]
url = "https://example.test/terrain3d.git"
root = "addons/terrain3d"
tag-prefix = "v"

[[package]]
name = "theme"
[package.http]
version = "1.2.3"
url = "https://example.test/theme-1.2.3.zip"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
root = "addons/theme"
```

Each `[[package]]` entry has a `name` and exactly one source table:

| Source table | Required fields | Optional fields |
| --- | --- | --- |
| `[package.git]` | `url`, `root` | `tag-prefix` |
| `[package.http]` | `version`, `url`, `sha256`, `root` | None |

Schema parsing rejects unknown fields, missing required fields, incorrect TOML
types, unsupported schemas, invalid UTF-8, and invalid TOML syntax. It groups
entries by package name and orders package names and candidates deterministically.

Schema one has no extension fields. Canonical serialization emits only its
declared fields, sorted by package and candidate, with normalised validated
values; comments and formatting are not retained. Future fields require a
schema change.

Before resolution, validate the parsed catalog. Validation is also side-effect
free: it does not fetch sources or access declared paths. It rejects:

- non-canonical package names;
- roots that are empty, absolute, traversal-based, or platform-prefixed;
- Git and archive URLs containing credentials or unsupported URL forms;
- invalid Git tag prefixes, HTTP versions, or SHA-256 checksums; and
- duplicate candidates after URL and root canonicalisation.

Validation returns typed canonical package names, Git identities, Semantic
Versions, checksums, and normalised source-relative roots. `wukong lock` uses
the catalog when every direct manifest dependency is a version requirement;
the resulting schema-three lock records the complete selected closure. See
[ADR 0042](adr/0042-project-source-catalog.md).

Each validated package candidate has a deterministic SHA-256 fingerprint of its
canonical reviewed declaration. Schema-three catalog graph locks record that
per-package fingerprint as `catalog_sha256`, without persisting credentials or
mutable selectors. See [catalog graph lockfiles](lockfile.md#schema-three-catalog-graphs).

## Git tag candidates

The Git catalog adapter discovers matching SemVer tags in deterministic version
order. It returns each version with the complete commit currently named by that
tag, the canonical repository URL, and the declared package root. Discovery
does not fetch package content or write a lockfile; only a later lock operation
can persist the observed complete commit as the immutable source identity.

With offline discovery, Wukong accepts only verified cached tag metadata for
the same canonical URL and `tag-prefix`. Missing or corrupt metadata fails with
an instruction to retry online; Wukong does not guess from a mutable tag.

Before lock publication, a selected Git candidate must contain valid
`wukong-package.toml` below its declared root. Wukong compares the selected tag
version with `package.version` after removing SemVer build metadata. A mismatch
diagnostic identifies the package, selected tag, and observed metadata version.

## HTTPS archive candidates

The HTTPS catalog adapter accepts only validated candidates, so each candidate
has an explicit URL, SHA-256 checksum, version, and safe package root. It
reuses the archive fetcher's HTTPS-only redirect, TLS, checksum, and verified
warm/offline-cache behaviour, then extracts the ZIP into disposable staging.
Before admission, `wukong-package.toml` below the declared root must agree with
both the catalog package name and canonical version; build metadata does not
affect the version comparison. No lockfile or prepared package cache entry is
published during this validation.

Catalog entries cannot use local paths. Local paths are direct development-only
manifest declarations and never enter a portable transitive graph.

## Lazy acquisition

Core callers acquire catalog candidates by package name. An unknown or
unselected package has no source access. Acquisition checks cancellation before
each source operation, admits required metadata, and publishes the prepared
package tree through the existing content-addressed cache. Clones coordinate
same-package acquisition and re-verify every cache object before returning it;
corrupt objects therefore fail before a candidate can be reused.

Before resolver selection, Wukong collapses exact immutable duplicates. A
package version available from distinct canonical source identities is rejected
with every conflicting source named in deterministic order.

## Resolver universe

`CatalogUniverse` adapts lazy catalog acquisition to the source-neutral
resolver. The resolver asks only for direct roots and their transitive package
names; each request exposes canonical versions and package-owned dependency
requirements, without exposing Git or HTTP fields to resolver logic.

It selects the highest compatible new candidate and retains a valid locked
selection when requested. If no reviewed candidate satisfies a requirement,
the diagnostic names that package and requirement; incompatible non-empty
constraints retain the resolver derivation. Cancellation is checked before
catalog acquisition. This core API may populate and verify the shared cache,
but never reads or mutates a Godot project, manifest, lockfile, or installed
state. The lock service turns its selected candidates into a schema-three
lockfile only after all required candidates have been acquired and verified.

Resolver requests classify direct roots as runtime or development. The resolved
graph derives the complete closures: development-only packages are excluded
from runtime selection, while any package also reachable from a runtime root is
promoted to runtime and selected once. Sync materialises that persisted closure
through the same ownership preflight and transaction boundary as direct locks.
It never resolves a catalog during materialisation.

`wukong update <root>` refreshes one persisted direct root and its reachable
closure. Packages outside both the previous and new closure remain byte-for-byte
locked; if that cannot be preserved, the update fails rather than broadening
its scope. `wukong update --dry-run` uses only cached source artifacts and
disposable staging, and never publishes a cache object.

Existing direct remote projects can use [`wukong migrate`](migrate.md) to
create their initial catalog and schema-three lock only when the conversion is
lossless. It never overwrites an existing catalog.

Core callers can add or remove one candidate transactionally. The edit holds a
per-catalog advisory lock, validates the complete output before publication,
and atomically replaces the catalog. Existing TOML content outside the edited
candidate remains unchanged.

`wukong source add` adds one reviewed candidate without fetching it:

```sh
wukong source add terrain3d --git https://example.test/terrain3d.git --root addons/terrain3d --tag-prefix v
wukong source add theme --url https://example.test/theme.zip --version 1.2.3 --sha256 <64-lowercase-hex> --root addons/theme
```

The command accepts `--project <path>`, creates a schema-one catalog when it
is absent, and rejects unsafe or duplicate declarations before publication.

`wukong source remove <name>` removes the candidate when that name has exactly
one candidate. For packages with multiple candidates, supply every candidate
field to make the selection exact:

```sh
wukong source remove terrain3d --git https://example.test/terrain3d.git --root addons/terrain3d --tag-prefix v
wukong source remove theme --url https://example.test/theme.zip --version 1.2.3 --sha256 <64-lowercase-hex> --root addons/theme
```

Missing or ambiguous selections fail before the catalog changes.

## Inspecting sources

`wukong source list` reads and validates the project catalog without fetching
sources or changing project files. It prints canonical package and candidate
data in deterministic order. `--json` emits protocol-v1 JSON Lines; use
`--project <path>` to select a project explicitly.

Its terminal JSON result has `schema: 1` and `packages` in canonical name
order. Each package contains `name` and `candidates`; Git candidates expose
`kind`, `url`, `root`, and nullable `tag_prefix`, while HTTP candidates expose
`kind`, `version`, `url`, `sha256`, and `root`.

`wukong source validate` reports every semantic declaration failure in a stable
order without fetching sources or changing project files. On success it prints
`source catalog: valid`; `--json` emits protocol-v1 start/progress events and a
terminal success result. A validation failure exits with code 2 and emits one
protocol-v1 diagnostic line per failed declaration field.
