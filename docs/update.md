# Update

`wukong update [package]` re-locks supported direct dependencies or a
schema-three catalog graph, then transactionally synchronises package files.
Without a package it refreshes every catalog root and closure. With one catalog
root, it refreshes that root's reachable closure while retaining packages
outside its previous and new closure exactly as-is.

```sh
wukong update
wukong update example-addon
wukong update example-addon --dry-run
```

`--dry-run` resolves the candidate lockfile and prints each version or immutable
source identity change without changing `wukong.lock` or project files. Catalog
dry runs additionally use only already cached source artifacts and prepared
data, so they never publish a package cache object; missing cached input fails
with no mutation.
`--offline` permits only cached Git and HTTPS sources and lists every
unavailable artifact selected for update. A selected update refuses
to run when any unrelated manifest declaration differs from its lockfile entry;
run `wukong lock` first so it cannot silently retain stale state. It also rolls
back its new lockfile when synchronisation detects a changed unrelated local
source.

Direct updates support development local paths, Git sources, and checksum-pinned
HTTPS archives. Version-only manifests use the reviewed project catalog and
schema-three lock. A selected catalog update fails rather than changing a
selection outside that root's closure. Package scripts are never executed.
