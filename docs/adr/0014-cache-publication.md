# ADR 0014: cache publication

## Status

Accepted

## Context

Prepared package trees are immutable objects addressed by their canonical
content hash. A cache reader must never observe an incomplete object, and a
concurrent writer must not make an existing object unverified.

## Decision

Copy the prepared tree to a unique temporary directory beside its final
content-addressed directory. Re-prepare and hash that copy, flush its files,
and rename only the complete directory to `packages/sha256/<digest>`. Flush
the parent directory where the platform supports directory flushing, then
re-prepare the published object and verify its digest.

If another publisher has already created the final path, verify and reuse that
object. A mismatched object is an integrity failure and is never overwritten.
Temporary directories are owned by `TempDir` and are removed on normal failure
paths. Removal of crash-abandoned directories is deferred to cross-process
locking because a process cannot safely distinguish an abandoned candidate
from another process's active candidate without coordination.

## Consequences

Readers use only final content-addressed paths and therefore see either no
object or a complete verified tree. Publication performs an additional tree
read and hash, prioritising integrity over write speed. Windows-style refusal
to rename over an existing directory follows the same verify-and-reuse path.

## Alternatives considered

- Writing directly to the final directory: rejected because readers could
  observe incomplete content.
- Deleting or replacing an existing final directory: rejected because a
  corrupt or concurrently written object must be diagnosed, not overwritten.
- Time-based temporary-directory cleanup: rejected because timestamps cannot
  safely establish whether another process is still publishing.

## Migration and compatibility impact

This adds publication semantics below the existing `v1` cache schema. No
persisted object format changes.
