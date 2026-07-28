# Versioning

Wukong uses the Rust `semver` crate's Cargo-compatible requirement syntax for
project Godot compatibility, version-only dependencies, package metadata, and
package dependency metadata.

| Form | Meaning |
| --- | --- |
| `=1.2.3` | Exactly `1.2.3`. |
| `>=1.2.0,<2.0.0` | Intersection of comparator ranges. |
| `^1.2.3` | Compatible caret range. |
| `~1.2.3` | Patch-level tilde range. |

Unprefixed `1.2.3` follows Cargo semantics and is a caret requirement, not an
exact pin. Use `=1.2.3` when exact selection is required. Pre-release versions
match only requirements that explicitly name a pre-release for the same
major/minor/patch release. Build metadata is ignored for version precedence. Unsupported syntax, an empty
requirement, and a missing package metadata version are user errors.

Path, Git, and checksum-verified HTTP dependencies are source-pinned and have
no version catalogue. Their immutable local snapshot, Git commit, or archive
checksum is the selected source identity. A version-only declaration is a
future catalogue dependency and is not interchangeable with a source-pinned
declaration.

This intentionally follows Cargo-compatible SemVer rather than npm-style
version grammar; for example, alternatives separated by `||` are not accepted.
Version discovery and transitive version selection are deferred to W062 and
W063.
