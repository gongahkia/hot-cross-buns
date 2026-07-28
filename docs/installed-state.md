# Installed state

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
package = "example-addon"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
materialization = "copy"
```

The metadata records only Wukong-owned paths. A future synchronisation removes
a file only when prior state proves ownership and its recorded hash still
matches. State-file publication is part of the W055 project transaction. See
[ADR 0016](adr/0016-installed-state-schema.md).
