# ADR 0038: direct-dependency layout overrides

## Status

Accepted

## Context

A source repository can contain more than one Godot addon. Existing direct
declarations rely on layout inference or optional package-owned metadata, so a
project cannot select one addon from a repository that does not provide Wukong
metadata. The selected directory and target affect the prepared tree, lockfile,
and ownership map.

## Decision

Permit optional `root` and `target` fields on every direct-source inline table
in `wukong.toml`. `root` selects a safe source-relative directory and `target`
selects a safe project-relative installation directory. Both are recorded in
the lockfile through its existing `source_subdirectory` and `target_path`
fields. An explicit manifest value takes precedence over package-owned
metadata; an omitted value retains metadata then inference behaviour.

Both fields reject empty, absolute, traversal, Windows-drive, and backslash
paths. They are included in the declaration fingerprint, so changing either
requires a new lock rather than reusing stale prepared content.

## Consequences and alternatives considered

Projects can lock two directories from the same immutable source under
different aliases without source-specific resolver fields. It increases the
manifest surface but does not change existing declarations or lockfile schema.

Requiring `wukong-package.toml` in every source was rejected because existing
multi-addon repositories need not adopt Wukong. Extending source URLs with a
fragment was rejected because fragments are source-specific and can undermine
canonical source identity.

## Migration and compatibility impact

Existing manifests keep their behaviour. Older Wukong versions reject these
new fields rather than silently choosing a different layout. Existing
lockfiles remain schema-compatible because the selected layout fields already
exist.
