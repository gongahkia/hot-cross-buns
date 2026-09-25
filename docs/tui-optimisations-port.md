# HCB Electron core and Google-sync status

The historical Electron snapshot at Gator commit `f0b6a711b8c821b06045f3f3a2d1baa7e7b1408c` contains the restored renderer and native-shell source, but not its tracked main-process entry point, preload bridge, or Google transport. It is therefore not evidence of a pre-existing functional Google backend.

## Current implementation

The active Electron backend is local-first SQLite in WAL mode. It owns data, credentials, and sync; the renderer only uses the context-isolated preload API.

Implemented foundations:

- SQLite migrations, FTS5 local search, local task/event/note persistence, and renderer request limits.
- Encrypted OAuth credential envelope through Electron `safeStorage`; SQLite stores only non-secret account metadata.
- Desktop OAuth PKCE with a loopback callback and refresh-token renewal.
- Google Tasks task-list/task pull and durable task-list/task create, update, completion, delete, parent move, and cross-list copy/delete delivery.
- Google Calendar list/event pull, incremental event sync tokens, `410` token recovery, ETag-guarded event updates/deletes, and event create/update/delete delivery.
- Ordered SQLite outbox delivery, bounded exponential retry, conflict retention, live renderer sync-status events, and diagnostics retry/cancel views.
- Task time-blocks backed by real Calendar events rather than a mock response.

Google Tasks does not provide an incremental collection cursor comparable to Calendar's event sync token, so task lists and tasks are paged on each sync. Calendar event collections persist provider sync tokens and re-run a full collection sync after an HTTP `410`, consistent with the Google Calendar incremental-sync contract.

## Local test setup

Run `corepack pnpm install`, then `corepack pnpm dev`.

In HCB Settings, enter the client ID for a Google Cloud **Desktop application** OAuth client. A client secret is optional for installed-app OAuth clients. The configured client must have the Google Tasks API and Google Calendar API enabled, and its consent screen must allow the account used for testing. HCB opens the browser for consent and receives the callback at an ephemeral `127.0.0.1` port.

Run the available checks with:

```sh
corepack pnpm test:unit
corepack pnpm test:smoke
```

The smoke test covers the Electron launch, SQLite migrations, local task/event/note writes, FTS search, scheduled task blocks, and the disconnected sync path. It does not authorize a real Google account; production sync still requires dedicated API-contract and account-isolated integration coverage.

## Work still required for full product parity

- Strong, per-operation Zod DTOs and removal of temporary `any` contracts.
- Production recurrence-instance semantics, exceptions, and series/occurrence edit scopes.
- Completing or removing the remaining restored placeholder surfaces: attachments, ICS subscriptions, portable archive, vault remote, extensions, semantic models, notifications, tray, updater, MCP, and agent actions.
- Restore and compile the missing native service dependencies rather than excluding `src/main/native` from TypeScript.
- Replace legacy JSON planner/settings initialization with a one-time migration or removal.
- Add Google API fixture tests for pagination, refresh-token errors, `401`, `412`, `410`, outbox retries, and multi-account isolation.
