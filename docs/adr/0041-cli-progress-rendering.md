# ADR 0041: CLI progress rendering

## Status

Accepted

## Context

Sync needs interactive package-level feedback without exposing terminal details
to the reusable core library or corrupting JSON automation output.

## Decision

Use the MIT-licensed `indicatif` 0.18.6 crate in `wukong-cli` only. The Rust
standard library can detect a terminal but does not provide coordinated,
cross-platform spinner and progress-bar rendering. Core emits deterministic
domain progress events; the CLI renders them only on an interactive stderr.

`--no-progress` and `WUKONG_NO_PROGRESS=1` disable human progress. JSON and
non-terminal output remain non-ANSI.

## Consequences

The CLI has one maintained terminal-rendering dependency. Core domain APIs and
the JSON protocol remain terminal-independent.

## Alternatives considered

- Custom ANSI rendering: rejected because cursor control, refresh, and output
  interleaving would duplicate cross-platform terminal behavior.
- Human progress in core: rejected because core must not depend on terminal
  concerns.

## Migration and compatibility impact

No manifest, lockfile, cache, or installed-state format changes.
