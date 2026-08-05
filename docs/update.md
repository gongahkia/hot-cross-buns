# Update

`wukong update [package]` re-locks supported direct dependencies, then
transactionally synchronises their package files. Without a package it updates
all direct runtime and development dependencies; with one package it retains
every unrelated lock entry exactly as-is.

```sh
wukong update
wukong update example-addon
wukong update example-addon --dry-run
```

`--dry-run` resolves the candidate lockfile and prints each version or immutable
source identity change without changing `wukong.lock` or project files.
`--offline` permits only cached Git and HTTPS sources and lists every
unavailable artifact selected for update. A selected update refuses
to run when any unrelated manifest declaration differs from its lockfile entry;
run `wukong lock` first so it cannot silently retain stale state. It also rolls
back its new lockfile when synchronisation detects a changed unrelated local
source.

Supported declarations are development local paths, Git sources, and checksum-pinned HTTPS
archives. A version-only declaration remains unsupported until a package
catalogue source is available; Wukong rejects it before lockfile or project
mutation. Package scripts are never executed.
