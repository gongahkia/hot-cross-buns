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
Versions, checksums, and normalised source-relative roots. The catalog is not
yet consumed by lock or sync commands. See [ADR 0042](adr/0042-project-source-catalog.md).

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
