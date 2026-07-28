# Outdated

`wukong outdated` is read-only with respect to the project: it reports newer
version tags for Git-locked packages and explains why a package cannot be
compared; it never modifies the lockfile or project files. Online Git checks
may refresh verified tag metadata in the cache.

```sh
wukong outdated
wukong outdated --offline
wukong outdated --json
```

Git discovery checks exact semantic-version tags first, then retries `v`-prefix
tags only when no exact version tags exist. A locked Git commit without a
semantic-version tag, or a repository without version tags, is reported as
unavailable rather than guessed. Local paths and checksum-pinned archives are
also unavailable because they do not expose a mutable version catalogue.

For a version-tagged Git package, `compatible` means the newest version allowed
by the caret requirement inferred from its locked tag; `breaking` is the newest
newer tag outside that range. Git source declarations currently do not include
a manifest version range. `--offline` uses only verified cached tag metadata.

`--json` emits deterministic schema-one output with one record per package in
canonical name order. Each record includes `status`, `current`, `compatible`,
`breaking`, and `reason` fields; unavailable values are `null`.
