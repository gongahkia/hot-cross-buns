# `wukong package validate`

Validate package-owned metadata without changing any files:

```sh
wukong package validate
wukong package validate --path path/to/addon
wukong package validate --json
```

Without `--path`, the current directory is the package root. Validation reads
only `wukong-package.toml` and checks schema-one fields, canonical package name,
complete semantic version, Godot version requirement, safe layout paths, and
dependency requirements. It performs no network I/O, project discovery, source
fetching, cache access, or package-script execution.

Human output confirms the validated metadata path. `--json` emits one
protocol-v1 result event on success, or one protocol-v1 diagnostic on failure.
