# ADR 0017: desired ownership maps

## Status

Accepted

## Decision

Build a deterministic project-relative file map from canonical package trees
before any project mutation. A map entry records source path, SHA-256,
executable bit, and all package owners. Identical exact-path claims share an
entry; incompatible exact claims and NFC case-folded collisions fail with
package names. Existing project files are rejected unless prior state proves
the target was Wukong-owned.

## Consequences

Synchronisation has a complete conflict report before staging. Identical shared
files require later state metadata to retain every owner before safe removal.
