# Hot Cross Buns feature checklist

## Implemented in the current application

- [x] Electron desktop application with a hardened preload bridge and local SQLite store.
- [x] First-run onboarding and editable Settings screens for Profile, Appearance, Hotkeys, Alerts, and About.
- [x] Command palette and keyboard-first navigation.
- [x] Split-pane workspace, tab dragging, nested splits up to four panes, and adjustable split dividers.
- [x] Embedded browser panes for web URLs.
- [x] Theme selection, including the imported Ghostty-inspired themes.
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

## Verification currently in the repository

- [x] Type checks for the renderer/preload app and stricter main-process core.
- [x] Unit tests for bridge, result, settings, and retained legacy-store compatibility.
- [x] Electron-runtime SQLite tests for account ID isolation, task blocks, undo/redo, smart scheduling, and Calendar moves.
- [x] Electron smoke test for launch, task/event/note writes, task blocks, availability, undo/redo, search, and disconnected sync.
- [x] Parameterized Electron performance fixture (`HCB_PERF_COUNT`) for equal numbers of local tasks and local events.
- [x] Local 5,000-task + 5,000-event sample: task writes 13.80 s; event writes 12.37 s; FTS query 18.06 ms; five 1,000-item Calendar range pages 1.58 s.
- [x] Local 10,000-task + 10,000-event sample: task writes 29.70 s; event writes 24.45 s; FTS query 20.30 ms; ten 1,000-item Calendar range pages 3.28 s.

## Implemented but still awaiting live Google-account validation

- [ ] OAuth browser consent and localhost callback against a separately supplied Desktop OAuth client.
- [ ] Token refresh and reconnect behavior against a live account.
- [ ] Two-account sync, conflict handling, offline recovery, shared calendars, and recurrence edge cases against live Google data.
- [ ] Real Google Tasks and Calendar mutation round trips, including list/task moves and Calendar event moves.

## Intentionally hidden and deferred

- [ ] HCB Vault/local remote sync — dormant shell only; no supported remote protocol, encryption lifecycle, or recovery UX.
- [ ] MCP local server and agent actions — dormant shell only; no enabled listener, authentication flow, permission model, or audited tool implementation in the running app.
- [ ] ICS import and calendar subscriptions — dormant shell only; no supported parser, subscription refresh policy, or conflict model.
- [ ] Event/task attachments and local file pointers — dormant shell only; no supported file lifecycle, Google Drive integration, or safe sharing model.
- [ ] Extensions and snippets — dormant shell only; no sandboxing, lifecycle, or compatibility contract.
- [ ] Semantic-search model installation — dormant shell only; no model runtime, indexing policy, or data-retention controls.
- [ ] Portable archive import/export — dormant shell only; no stable archive format, migration guarantees, or restore verification.

## Not implemented

- [ ] Google Meet / Calendar conferencing creation, editing, or join-link management.
- [ ] Calendar attendee RSVP workflow, response-status editing, or attendee availability lookup.
- [ ] Google Calendar attachment management or Google Drive file-picker integration.
- [ ] Calendar Focus Time, Goals, Out of Office, and Working Location event types.
- [ ] Gmail integration, email-to-task capture, message linking, or email reminders.
- [ ] Google Drive, Contacts, Chat, or other Google Workspace product integrations.
- [ ] Google push-notification watches/webhooks; synchronization currently uses startup/manual/debounced/five-minute polling.
- [ ] Cross-account Calendar event moves or account merging.
- [ ] A production release, notarized installer, or end-user validation on macOS, Windows, and Linux.
