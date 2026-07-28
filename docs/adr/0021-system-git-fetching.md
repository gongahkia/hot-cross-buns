# ADR 0021: system Git fetching

## Status

Accepted

## Context

Git fetching must use existing SSH and credential-manager configuration while
publishing only verified immutable commits to the cache on macOS, Linux, and
Windows.

## Decision

Invoke the user-installed `git` executable through argument-vector process
calls; no shell, credential callback, `GIT_SSH_COMMAND`, or submodule command
is used. Fetches force `fetch.recurseSubmodules=false` and
`submodule.recurse=false`.

Stage a detached checkout in a temporary cache sibling, verify `HEAD` is the
resolved complete commit and the checkout is clean, then atomically rename it
under a SHA-256 key derived from canonical source plus commit. Selector metadata
contains only the complete commit. A scoped advisory file lock serialises one
source-selector fetch. `fs2` 0.4.3 (MIT/Apache-2.0, no declared MSRV) supplies
cross-platform advisory locks; it compiled under Rust 1.85 in this workspace.

## Consequences

Authentication behavior stays with the user's Git configuration. Cache paths,
metadata, and diagnostics exclude source credentials. A missing Git executable
or failed fetch returns a source diagnostic and leaves no published checkout.

## Alternatives considered

- `git2`: rejected because its credential integration would not naturally use
  the user's Git credential helpers and it adds a native Git implementation.
- Shell commands: rejected because source values must never be interpreted by a
  shell.
- Unlocked cache writes: rejected because concurrent fetches can duplicate work
  or expose conflicting publication attempts.
