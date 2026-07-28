# ADR 0033: Hashed transaction recovery

## Status

Accepted

## Context

Project sync recovers an incomplete journal by removing files written by the
transaction before restoring backed-up files. A non-cooperating process or user
can alter a written file after interruption and before recovery. Removing it
blindly would delete an edit that Wukong no longer owns.

## Decision

Transaction journal version two records the SHA-256 of every staged regular
file and staged state file before it is published. Recovery removes a written
output only when it remains a regular file with that exact recorded hash. It
then restores the rollback entry.

Recovery refuses and leaves the transaction intact when an output is absent
from the expected type/hash, or when a legacy version-one journal would need to
remove an unverified output. A version-one transaction that stopped before a
write can still restore its moved files safely. The diagnostic directs the user
to preserve the current file and inspect `.wukong/.transaction` manually.

## Consequences

Interrupted recovery is fail-closed for concurrent edits. Users upgrading with
an already-interrupted version-one transaction that has published a file must
resolve that transaction manually rather than risk automatic deletion. Normal
new transactions remain automatic and deterministic.

## Alternatives considered

- Delete every journaled output during recovery: rejected because it can remove
  a concurrent edit.
- Restore rollback files over current files: rejected for the same reason.
- Trust advisory locks alone: rejected because they coordinate Wukong
  processes, not editors or other filesystem writers.

## Migration and compatibility impact

The private transaction journal changes from `v1` to `v2`; manifest,
lockfile, installed-state, and cache schemas do not change. Version-one
journals are parsed only for safe rollback cases and otherwise require manual
recovery.
