# HCB TUI core improvements ported to Electron

This repository revives the HCB 2 Electron application. The HCB Python CLI/TUI
implementation that followed it established a number of backend and safety
properties worth retaining. This document distinguishes a behaviour that is
implemented in Electron from one that requires a future Google/SQLite adapter;
it does not treat a design note as shipped behaviour.

## Source evidence

The comparison source is Gator commit `f0b6a711b8c821b06045f3f3a2d1baa7e7b1408c`,
the final pre-retirement HCB tree. Its `docs/specs/local-data.md`,
`docs/specs/google-sync.md`, `docs/architecture/desktop-bridge.md`, and
`docs/testing/performance-baseline.md` describe the shared core rather than
the terminal presentation.

## Port ledger

| HCB core behaviour | Electron implementation | Status |
| --- | --- | --- |
| Validate every frontend/core boundary | Strict Zod schemas in the preload and main-process IPC handlers | Implemented |
| Local-first mutation before remote delivery | `PlannerStore` updates the local task snapshot and queues its outbox item in one serialized commit | Implemented |
| No lost response on retry | Seven-day idempotency receipts bind a key to one exact operation and result | Implemented |
| Ordered durable mutation delivery | A persisted outbox delivers the oldest pending mutation first; retryable failures retain it and stop later delivery | Implemented |
| Backoff and conflict visibility | Retryable failures use bounded exponential backoff; non-retryable outcomes remain visible as conflicts | Implemented |
| Bounded reads for large workspaces | Title-first local search, 1–200 item pages, and revisioned opaque cursors | Implemented |
| Safe local persistence | One in-process writer queue plus atomic write-then-rename files in a `0700` directory and `0600` data files | Implemented |
| Secrets excluded from state, output, and diagnostics | Planner state has no credential fields; renderer has only a narrow validated API | Implemented |
| SQLite WAL, migrations, and cross-process locking | Requires the planned Electron SQLite adapter; an atomic file store is deliberately not represented as a substitute | Deferred |
| OAuth PKCE, encrypted refresh tokens, Google Tasks/Calendar cursors and ETags | Requires user-supplied OAuth configuration and a Google transport adapter | Deferred |
| Remote pull paging/prefetch and provider-specific `410` recovery | Requires that same transport adapter and integration fixtures | Deferred |

## Current delivery contract

The Electron renderer never opens the local data file. It may request a
workspace summary, a bounded task page, an optimistic task save/completion, or
sync status through the preload bridge. The main process owns validation,
storage, data revision, idempotency, and the outbox.

The outbox is intentionally transport-neutral today. It is ready for a Google
adapter but does not claim that local tasks have been synchronized remotely.
That prevents the previous class of UI behaviour where a successful local edit
could be mistaken for a successful API call.

## Verification

`src/main/services/plannerStore.test.ts` covers atomic optimistic writes,
idempotency misuse, stale-page rejection, ordered retry behaviour, and visible
delivery conflicts. Run `pnpm test:unit` and `pnpm typecheck` before treating a
change to this layer as accepted.
