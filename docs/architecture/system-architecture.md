# System Architecture

## Overview

Hot Cross Buns is an Electron desktop app with a strict separation between UI, privileged app services, and background work.

```text
Renderer (React)
  -> Preload API
  -> Electron main IPC handlers
  -> Domain services
      -> SQLite repositories
      -> Google Tasks/Calendar clients
      -> MCP server
      -> native desktop adapters
```

Google Tasks and Google Calendar remain the synced sources of truth. The local SQLite database is a fast cache and local operating store, not an independent cloud data model.

## Processes And Responsibilities

### Renderer

The renderer owns presentation, interaction state, routing, forms, keyboard-focused workflows, and optimistic UI display. It may hold sanitized task/event/note data returned by preload APIs.

The renderer must not:

- import Electron main modules
- access Node globals
- read or write files directly
- access SQLite directly
- access Google OAuth tokens or client secrets
- start network listeners
- bypass runtime request validation

### Preload

The preload script is the only bridge between renderer and main. It exposes a narrow `window.hcb` API and validates all inputs and outputs.

Preload APIs should be grouped by domain:

- `tasks`
- `calendar`
- `notes`
- `search`
- `sync`
- `settings`
- `mcp`
- `native`
- `diagnostics`

Every exposed method must have:

- a TypeScript request type
- a TypeScript response type
- a runtime schema
- a test covering validation failure

### Main Process

The main process owns Electron lifecycle and privileged orchestration:

- app startup/shutdown
- window creation and restoration
- tray and menu setup
- global shortcut registration
- notification scheduling
- deep link handling
- IPC handler registration
- service container setup
- worker lifecycle
- logging and diagnostics

Main must keep heavy sync, database, and MCP work out of the UI path. Long-running tasks should use worker threads or isolated async service queues.

### Workers And Services

Use workers or service modules for:

- SQLite reads/writes and migrations
- Google sync
- offline mutation application
- MCP HTTP handling
- search index preparation
- recurring diagnostics bundle creation

Service boundaries should be plain TypeScript interfaces so tests can run without Electron when possible.

## Data Flow

Read flow:

1. Renderer requests a view model through preload.
2. Preload validates request.
3. Main routes to a domain service.
4. Domain service reads SQLite and returns a sanitized DTO.
5. Renderer renders the DTO and tracks local UI state only.

Write flow:

1. Renderer submits a typed mutation through preload.
2. Main validates user permissions and service state.
3. Domain service writes a pending mutation and optimistic local state.
4. Google sync applies the mutation when online.
5. Sync result updates SQLite, checkpoints, diagnostics, and renderer subscriptions.

MCP write flow:

1. Local MCP client calls a tool on `127.0.0.1`.
2. MCP service authenticates bearer token and validates origin/body limits.
3. Read tools route directly to domain read services.
4. Write tools follow the same mutation services as UI writes.
5. Dry-runs return planned payloads without changing SQLite or Google.

## IPC Contract

IPC channels must be stable and versioned. Prefer a single domain method dispatch style over many ad hoc string channels.

Required response shape:

```ts
type HcbResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: HcbError };
```

Required error fields:

- `code`
- `message`
- optional `recoverable`
- optional `retryAfterMs`
- optional `details` with sanitized fields only

No IPC error may include tokens, raw Google payloads, full request bodies, local filesystem secrets, or MCP bearer tokens.

## Native Surfaces

macOS v1 must include:

- main window
- tray/menu bar entry
- app menu
- configurable global quick capture shortcut
- notification permission and scheduling
- custom protocol deep links

Deferred native parity:

- Spotlight indexing
- App Intents/App Shortcuts equivalent
- Share Extension equivalent
- richer background sync helpers

## Observability

The app must have structured local logs for:

- startup lifecycle
- sync attempts and outcomes
- OAuth state transitions without token values
- database migrations
- IPC validation failures
- MCP auth failures and write attempts
- tray/hotkey registration results

Diagnostics must be copyable from Settings and must redact secrets by default.

