# ADR 0030: advisory operation locks

## Status

Accepted

## Context

Cache publication, remote-source preparation, and project materialisation each
mutate shared filesystem state. Concurrent processes could otherwise observe or
remove another operation's staging files. Lock files must not themselves become
an unrecoverable stale-state mechanism after a process is interrupted.

## Decision

Wukong uses non-blocking exclusive advisory file locks. Cache prepared objects
lock `locks/sha256/<digest>.lock`; Git repositories lock their source-derived
cache lock; HTTPS archives lock their checksum-derived cache lock; and a
project mutation locks `.wukong/mutation.lock`.

An active lock returns a retryable `SourceAccess` diagnostic immediately. The
lock file remains after release. Operating-system advisory-lock lifetime
releases its held state when the owning process exits, so a later operation can
reacquire the file without deleting unproven state.

Prepared-package staging directories include their object digest. While holding
that object lock, Wukong may remove only matching abandoned staging directories.
It never removes generic or another object's candidates. There is no manifest,
lockfile, cache-object, or installed-state format change.

## Consequences

Parallel operations do not wait indefinitely or concurrently mutate a shared
resource. Automation receives a stable failure with a retry action. An
interrupted process is recoverable through normal lock release and scoped
staging cleanup. Persistent empty lock files are expected and safe.

## Alternatives considered

- Blocking locks: rejected because a stalled operation gives poor automation
  diagnostics and can wait indefinitely.
- Deleting old lock files: rejected because file existence does not prove a
  lock is held, and deletion races an active operation.
- One global cache lock: rejected because independent cache objects can proceed
  independently.

## Migration and compatibility impact

Existing cache and project state remain valid. Wukong may create persistent
empty lock files under existing lock roots and `.wukong/`.
