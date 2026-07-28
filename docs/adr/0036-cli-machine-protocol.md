# ADR 0036: CLI machine protocol

## Status

Accepted

## Context

Editor integration and automation need structured, streamable command output without parsing human diagnostics. Existing `--json` output is command-specific and does not cover progress or failures.

## Decision

Use opt-in UTF-8 JSON Lines protocol version one. Standard output carries ordered events; standard error carries one structured diagnostic on failure. Every object includes `protocol: 1`. Existing human output and exit-code meanings remain unchanged without `--json`.

Progress is advisory and clients must tolerate omitted or unknown events. Report-command success has one terminal result event; failure has one stderr diagnostic. Cancellation is signal-driven and reaches core operations through a shared cancellation token. A transaction either stops before commit or finishes its active commit as one valid state before reporting cancellation.

The CLI uses the maintained, cross-platform `ctrlc` crate because the Rust standard library has no cross-platform terminal-interrupt API. Its handler only sets the existing atomic cancellation token; filesystem recovery remains in core transaction code.

## Consequences

Commands need a shared renderer rather than hand-built JSON. The editor plugin can stream updates while preserving core-domain independence from terminal concerns.

## Alternatives considered

- One final JSON document: rejected because progress cannot stream.
- Parse human output: rejected because it is not a stable API.
- Add a local daemon: rejected because it introduces lifecycle, authentication, and compatibility work before a second consumer exists.

## Migration and compatibility impact

Protocol version one is additive and opt-in. Version changes are explicit in each event.
