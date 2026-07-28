# Local paths

Local dependencies accept relative paths resolved against `wukong.toml` and
absolute paths. Paths outside the Godot project are supported. The adapter
requires an existing directory and canonicalises it, including root symlinks.

It derives an immutable `sha256:` source revision from a sorted content walk.
Files, directories, and literal symlink targets are hashed; symlinks are not
followed. `.git` and caller-configured names are ignored at every depth. See
[ADR 0006](adr/0006-local-path-snapshot.md).

## Dependency guide

Declare a local addon relative to the project manifest or by an absolute path:

```toml
[dependencies]
example = { path = "../example-addon" }
```

For a source containing multiple addons, select each directory explicitly:

```toml
[dependencies]
alpha = { path = "../addon-suite", root = "addons/alpha", target = "addons/alpha" }
beta = { path = "../addon-suite", root = "addons/beta", target = "addons/beta" }
```

Run `wukong lock` after any intended source change. A later sync refuses a
local tree whose immutable snapshot differs from the lockfile; this prevents a
silent install of changed development content. Local dependencies work with
`--offline` because they perform no network access.
