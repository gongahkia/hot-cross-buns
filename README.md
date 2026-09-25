# Hot Cross Buns feature checklist

## Implemented in the current application

- [x] Electron desktop application with a hardened preload bridge and local SQLite store.
- [x] First-run onboarding and editable Settings screens for Profile, Appearance, Hotkeys, Alerts, and About.
- [x] Command palette and keyboard-first navigation.
- [x] Split-pane workspace, tab dragging, nested splits up to four panes, and adjustable split dividers.
- [x] Embedded browser panes for web URLs.
- [x] Theme selection, including the imported Ghostty-inspired themes.
- [x] Settings-controlled `loading-dev` indicators for planner data/refreshes, command-palette search, and Mermaid previews; every surface defaults to Blocks and respects Disable animations.
- [x] Local Notes and Tags.
- [x] Local full-text search across tasks, events, and notes.
- [x] Undo/redo for task, event, and scheduled-task-block mutations.
- [x] Sync diagnostics, mutation history, and explicit Keep local / Keep Google conflict actions.
- [x] macOS native menu, tray/status reporting, deep-link routing, notification capability reporting, and external-link handling.
- [x] Capability-reporting native adapters for Linux and Windows source builds.

## Google account and sync foundation

- [x] Desktop OAuth client configuration stored outside the renderer and encrypted with Electron safe storage when available.
- [x] Add and disconnect multiple Google accounts independently.
- [x] Account-scoped local caches, sync tokens, credentials, outbox rows, and unique Google-resource identities.
- [x] Preserve cached data for a disconnected account instead of deleting it.
- [x] Manual sync, startup sync, five-minute background sync, and debounced sync after local writes.
- [x] Incremental Calendar sync tokens, pagination, ETags, retry/backoff, and durable outbox delivery.
- [x] Deterministic Calendar event IDs to make retrying an interrupted create safe.
- [x] Google Tasks create ambiguity is surfaced as a conflict rather than risking a duplicate task.
- [x] Selected task-list and calendar filtering.
- [x] Explicit developer database reset for the schema-v3 migration; it removes only HCB cache/credentials, never Google data.

## Google Tasks wrapper

- [x] Discover and display Google Task lists.
- [x] Create, rename, and delete task lists.
- [x] Create, edit, complete, reopen, and delete tasks.
- [x] Task title, notes, due date, duration, planning dates, priority, and locked-schedule fields.
- [x] Parent tasks and subtasks.
- [x] Reorder tasks and move them between lists in the same Google account through the Google Tasks move API.
- [x] Prevent cross-account task moves that Google cannot represent safely.
- [x] Bulk task rescheduling.
- [x] Quick schedule/reschedule a task onto a Calendar task block.

## Google Calendar wrapper

- [x] Discover and display multiple Google Calendars.
- [x] Create, edit, and delete Calendar events.
- [x] Timed and all-day events.
- [x] Event title, description, location, color, attendees, reminders, visibility, and transparency fields.
- [x] Recurrence rules for daily, weekly, monthly, and yearly events.
- [x] Edit or delete one occurrence, an entire series, or this-and-following through a series split.
- [x] Move an existing Calendar event between calendars in the same Google account through the Calendar move API.
- [x] Reject cross-account event moves rather than silently copying or orphaning events.
- [x] Turn a task into a real Calendar task-block event, then move or unschedule it.
- [x] Availability export from opaque events.
- [x] Preview-first smart scheduling that only creates or moves HCB task blocks after confirmation.
- [x] Time-zone-aware scheduling ranges, including daylight-saving transitions.
- [x] Google Meet creation requests, stored conference entry points, and join-link display for supported Google calendars.
- [x] Self-RSVP editing and read-only Google free/busy lookup for event guests.
- [x] Google Calendar status events: Focus Time, Out of Office, and Working Location on a connected primary calendar.
- [x] Drive metadata search and Calendar Drive-link attachment selection after explicit read-only Drive authorization.
- [x] Gmail metadata/snippet search and email-to-Task capture after explicit read-only Gmail authorization.
- [x] Explicit cross-account copy preview and copy workflow. Source data is preserved; copied events intentionally omit guests, Meet links, Drive attachments, and status-event types.

## Verification currently in the repository

- [x] Type checks for the renderer/preload app and stricter main-process core.
- [x] Unit tests for bridge, result, settings, and retained legacy-store compatibility.
- [x] Electron-runtime SQLite tests for account ID isolation, task blocks, undo/redo, smart scheduling, and Calendar moves.
- [x] Electron smoke test for launch, task/event/note writes, task blocks, availability, undo/redo, search, and disconnected sync.
- [x] Parameterized Electron performance fixture (`HCB_PERF_COUNT`) for equal numbers of local tasks and local events.
- [x] Named Electron scale-smoke commands for 1,000, 5,000, and 10,000 local tasks plus events; each verifies complete Task and Calendar pagination after writes.
- [x] Opt-in live Google suite with a main-process-enforced read-only mode for real accounts and an acknowledged create/update/delete mode confined to dedicated disposable-account resources. See `docs/live-google-testing.md`.
- [x] Mocked Google transport tests for pagination, incremental Calendar sync tokens, and Meet/attachment/status-event request encoding.
- [x] Renderer-scale measurements in the 1,000/5,000/10,000 Electron fixture: cache invalidation/cold hydration plus Tasks and Calendar route rendering after the local data checks.
- [x] Pull-request CI gate for build/typecheck, unit/mocked transport, Electron SQLite, and launch smoke tests. Live Google, performance, package signing, and notarization remain deliberately outside CI.
- [x] Local 1,000-task + 1,000-event scale smoke (2026-09-25): task writes 3.34 s; event writes 3.36 s; Task pagination 215.48 ms; FTS query 13.66 ms; Calendar pagination 533.28 ms; renderer hydration 800.88 ms; Calendar route 191.98 ms.
- [x] Local 5,000-task + 5,000-event scale smoke (2026-09-25): task writes 16.56 s; event writes 18.17 s; Task pagination 1.28 s; FTS query 15.90 ms; Calendar pagination 2.11 s; renderer hydration 600.54 ms; Calendar route 443.22 ms.
- [x] Local 10,000-task + 10,000-event scale smoke (2026-09-25): task writes 29.95 s; event writes 32.34 s; Task pagination 4.15 s; FTS query 33.00 ms; Calendar pagination 6.30 s; renderer hydration 1.22 s; Calendar route 220.64 ms.

## Implemented but still awaiting live Google-account validation

- [ ] OAuth browser consent and localhost callback against a separately supplied Desktop OAuth client.
- [ ] Token refresh and reconnect behavior against a live account.
- [ ] Two-account sync, conflict handling, offline recovery, shared calendars, and recurrence edge cases against live Google data.
- [ ] Real Google Tasks and Calendar mutation round trips, including list/task moves and Calendar event moves.

## Intentionally hidden and deferred

- [ ] HCB Vault/local remote sync — dormant shell only; no supported remote protocol, encryption lifecycle, or recovery UX.
- [ ] MCP local server and agent actions — dormant shell only; no enabled listener, authentication flow, permission model, or audited tool implementation in the running app.
- [ ] ICS import and calendar subscriptions — dormant shell only; no supported parser, subscription refresh policy, or conflict model.
- [ ] Local event/task file attachments and local file pointers — dormant shell only; no supported local-file lifecycle or sharing model. This does not apply to the implemented Google Calendar Drive-link attachment flow.
- [ ] Extensions and snippets — dormant shell only; no sandboxing, lifecycle, or compatibility contract.
- [ ] Semantic-search model installation — dormant shell only; no model runtime, indexing policy, or data-retention controls.
- [ ] Portable archive import/export — dormant shell only; no stable archive format, migration guarantees, or restore verification.

## Not implemented

- [ ] Google Meet conference removal, conference-provider selection beyond Google Meet, or Meet participant management.
- [ ] Organizer-side attendee editing, room/resource booking, and arbitrary attendee-response editing. HCB supports only the signed-in attendee's RSVP and read-only free/busy lookup.
- [ ] Drive binary upload/download, Drive permission changes, and attachment lifecycle management. HCB attaches existing Drive links only.
- [ ] Calendar Goals. Google Calendar's API does not expose a supported Goal-creation workflow; Focus Time, Out of Office, and Working Location are supported.
- [ ] Gmail send/reply/archive/label actions, mail reminders, attachment download, or background inbox synchronization. HCB only searches metadata/snippets and captures an explicit message as a Task.
- [ ] Google Contacts, Chat, or other Google Workspace product integrations.
- [ ] Google push-notification watches/webhooks; synchronization currently uses startup/manual/debounced/five-minute polling.
- [ ] Cross-account event moves, account merging/deduplication, source deletion, or copying guests/conferences/Drive attachments. HCB provides a safe one-way copy only.
- [ ] A production release, notarized installer, or end-user validation on macOS, Windows, and Linux.
