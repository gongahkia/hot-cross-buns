# Backend Optimization Improvements

## Comparison Basis

Legacy reference repo:

- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/App/AppModel.swift`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Sync`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Logging`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Notifications`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Services/Updates`

Current Electron rebuild:

- `src/main/services/sqliteDomainServices.ts`
- `src/main/sync`
- `src/main/native`
- `src/main/ipc/diagnostics.ts`
- `src/main/mcp`

Hot Cross Buns 2 already records pending mutations, performs Google read sync with checkpointing and retry classification, exposes diagnostics, and shares domain services between UI IPC and MCP. The key backend gap is that several legacy production behaviors are still scaffolded, synchronous, or not yet durable.

## Improvements To Add

### 1. Durable Google Mutation Worker

Legacy has optimistic write behavior and offline queue tests around applying pending mutations to Google.

Current status as of 2026-05-22: a main-process `GooglePendingMutationWorker` exists for task, task-list, and calendar-event queued writes. It is guarded by a process-local lock, selects due `pending`/retryable `failed` rows, applies Google write transports, updates local mirror rows with remote Google IDs/ETags, schedules exponential retry backoff for 429/5xx responses, marks 401/403 failures as account reauth-required, and keeps the worker out of renderer/preload source. Production OAuth transport construction and recurring scheduler triggers are still blockers.

Add a main-process mutation worker that consumes `google_pending_mutations`, calls Google Tasks/Calendar write APIs, updates local mirror rows with authoritative Google IDs/ETags, and transitions mutation status through `pending`, `applying`, `failed`, `applied`, or `cancelled`.

Implementation requirements:

- Use one worker instance guarded by a process-local lock.
- Pick due mutations by `status` and `next_retry_at`.
- Apply exponential backoff with jitter for 429 and 5xx.
- Treat 401/403 as auth failures that pause the queue and surface a settings action.
- Keep UI and MCP writes enqueue-only; the worker owns remote application.

Acceptance checks:

- Creating, editing, completing, reopening, moving, and deleting tasks eventually updates Google through the worker.
- Calendar event create/update/delete mutations use the same queue contract.
- Failed mutations appear in diagnostics and can be retried.
- The worker never runs in renderer.

### 2. Real Sync Scheduler

Legacy has sync modes, lifecycle-triggered refresh, near-real-time polling, checkpoint invalidation recovery, tombstone purge, and backoff behavior.

Extend current `GoogleReadSyncService` into a scheduler owned by the main service container. It should support manual-only, balanced, and near-real-time modes; trigger on launch, window restore, foreground activation, manual refresh, and periodic polling; and respect retry delays after Google failures.

Acceptance checks:

- Manual mode only syncs on explicit user action.
- Balanced mode syncs on launch/restore/foreground with a debounce window.
- Near-real-time mode polls only while foregrounded and backs off on recoverable failures.
- Invalid Calendar sync tokens clear the affected checkpoint and retry full sync for that calendar.

### 3. Debounced Side Effects

Legacy debounces notification and Spotlight side effects and tracks dirty items after mutations.

Add a side-effect scheduler for notification refresh, badge counts, tray state, search index repair, diagnostics snapshots, and future Spotlight/share integrations. Use a persisted dirty queue for work that must survive app restart and in-memory debounce for cheap refreshes.

Acceptance checks:

- Rapid task/event mutations schedule one notification refresh, not one per row.
- Restart after mutation still processes persisted dirty side effects.
- Side-effect failures are logged but do not roll back domain writes.

### 4. Credential And Token Storage

Legacy stores OAuth and MCP secrets through platform-secure storage.

Replace in-memory or placeholder credential handling with a main-process credential service. On macOS, use Keychain-backed storage through the native adapter; on future platforms, route through the platform credential adapter described in the porting docs. Never expose raw secrets through diagnostics or renderer IPC.

Acceptance checks:

- OAuth refresh tokens survive app restart.
- MCP bearer token survives restart and can be reset without revealing the new value.
- Diagnostics include token state and revision metadata only.
- Renderer cannot read stored secrets.

### 5. Runtime Logging, Audit, And Diagnostic Bundles

Legacy has app logging, mutation audit log, diagnostic bundle export, crash breadcrumb readers, and recovery tools.

Add rotating local logs and a sanitized diagnostic bundle generator. Include build metadata, settings summary, sync status, pending mutation counts, checkpoint counts, slow SQLite samples, recent app logs, MCP metrics, and native capability status. Add an append-only mutation audit trail for user-originated writes.

Acceptance checks:

- Copy diagnostics and export diagnostics use the same redaction rules.
- Bundle generation works offline.
- Audit entries include operation, entity type, local ID, timestamp, and actor source.
- Raw tokens, raw Google payloads, and request bodies are redacted.

### 6. Native Service Lifecycle Completion

Legacy has working local notifications, updater checks, menu bar lifecycle, deep links, open-at-login, dock badge, and MCP server lifecycle.

Finish the Electron native service lifecycle so status values no longer remain `pending` where the adapter can actually start the service. Defer expensive services until shell visible, but once deferred startup runs, keep state accurate and recoverable.

Acceptance checks:

- MCP listener starts and stops from settings with the stored bearer token.
- Local notifications are scheduled from cached due tasks and events.
- Updater check reports latest release state or a recoverable network error.
- Tray, shortcut, notification, updater, and MCP statuses survive settings changes.

## Recommended Starting Point

Start with the durable Google mutation worker. It is the backend feature that makes current optimistic UI writes trustworthy and gives tests, diagnostics, MCP, and sync scheduling a concrete queue lifecycle to exercise.
