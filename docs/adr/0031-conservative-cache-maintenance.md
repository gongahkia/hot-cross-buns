# ADR 0031: conservative cache maintenance

## Status

Accepted

## Context

Cache maintenance must reclaim Wukong-owned data without deleting project files,
foreign entries, or an object an active operation may still be publishing.
Prepared packages and HTTPS archives have content/checksum-addressed names with
matching lock paths. Current Git checkout and metadata paths do not expose the
per-source lock identity from every stored object name.

## Decision

`wukong cache dir` prints the active schema root. `wukong cache status` reports
deterministic category counts and recursively calculated byte sizes without
following symlinks. `wukong cache clean [--dry-run]` targets only recognized
prepared-package directories and checksum-addressed HTTPS archive files.

Clean acquires every targeted object's advisory lock before deleting any
candidate. It preserves unrecognized entries, lock files, Git checkouts, and
metadata. `--dry-run` reports the same deterministic candidate count and bytes
without mutation. Size output uses binary human-readable units.

## Consequences

Maintenance never needs project discovery and does not delete project-owned
files. Active cache operations block cleanup before mutation. Git cache data
can remain after clean; a later record may add it only when its matching lock
identity is derivable and tested.

## Alternatives considered

- Delete the whole schema root: rejected because it can race active writers and
  cannot distinguish foreign or lock state.
- Infer unused objects by scanning projects: rejected because project discovery
  is incomplete and absence from one scan does not prove an object is unused.
- Delete Git checkouts by checkout hash alone: rejected because that hash does
  not prove the associated source lock.

## Migration and compatibility impact

No cache format changes. Existing recognized package/archive cache entries may
be removed by an explicit clean command; all retained cache entries remain
compatible.
