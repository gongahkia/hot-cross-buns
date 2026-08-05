# Installed state

`wukong status` reads this metadata and reports the package identities actually
materialised in the project. `wukong status --json` is the editor-facing view;
it does not reimplement or infer package state from addon directories.

When a schema-three catalog lock is present, status enriches each matching
installed package with its persisted direct-root and derived group fields:
`direct_runtime`, `direct_development`, `runtime`, and `development`. Missing
or legacy lockfiles leave these JSON fields as `null`; installed state remains
the authority for what was materialised.

After transactional synchronisation, Wukong records package-owned project
files in `.wukong/state.toml`. Schema one is deterministic TOML:

```toml
schema = 1
groups = ["dependencies", "dev-dependencies"]

[[package]]
name = "example-addon"
source_immutable_id = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
package_sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

[[file]]
path = "addons/example-addon/plugin.gd"
packages = ["example-addon"]
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
materialization = "copy"
```

The metadata records only Wukong-owned paths. A future synchronisation removes
a file only when prior state proves ownership and its recorded hash still
matches. `packages` retains every identical-file owner. State-file publication
is part of the W055 project transaction. See
[ADR 0016](adr/0016-installed-state-schema.md) and
[ADR 0018](adr/0018-shared-file-ownership.md).
