# Google Sync Spec

## Scope

Hot Cross Buns syncs with Google Tasks and Google Calendar. Google remains the synced source of truth for tasks and events. SQLite stores local mirrors, settings, checkpoints, and pending mutations.

## OAuth

Use a desktop OAuth loopback flow. OAuth client configuration must support bring-your-own-client for preview builds.

Token rules:

- Access and refresh tokens must be stored in the OS keychain.
- Tokens must never be stored in renderer state, localStorage, sessionStorage, logs, SQLite, diagnostics, or MCP responses.
- Renderer may receive sanitized connection status only.
- OAuth errors must be translated into user-actionable messages.

## Scopes

Required Google scopes:

- `https://www.googleapis.com/auth/tasks`
- `https://www.googleapis.com/auth/calendar`

Requested identity scopes for account display:

- `openid`
- `email`
- `profile`

Do not request Google Drive or broader account scopes in v1.

## Tasks Mapping

Google Tasks backs:

- task lists
- task title
- task notes/details
- due date
- completion status
- parent/subtask relationships
- deleted/hidden/completed state

Local-only fields may include:

- UI expansion state
- local sort/grouping preferences
- local mutation metadata
- local diagnostics metadata

Time-specific task scheduling must be represented as a calendar event, not a Google Task due time. Hot Cross Buns stores a local scheduled-task-block link row so the timed calendar block can remain associated with its source task.

Scheduled-task-block reconciliation rules:

- A task can have only one active scheduled block in local metadata. Repeated scheduling of the exact same block is idempotent; scheduling the same task into a different slot must use move or unschedule first.
- If Google sync moves or resizes the linked Calendar event externally, the local block surfaces the Calendar event's current start/end and recalculates duration from that event.
- If Google sync deletes/cancels the linked Calendar event, the local block becomes orphaned and the renderer can repair it by creating a replacement Calendar event linked to the same task.

## Calendar Mapping

Google Calendar backs:

- calendar lists
- calendar selection and visibility
- events
- all-day events
- timed events
- recurring event instances
- reminders exposed by Calendar
- event location and description
- attendees/guests where supported by the API path

Calendar incremental sync should use `nextSyncToken` after initial full sync. If Google invalidates a token, the app must perform a full resync for that calendar.

## Sync Modes

Required sync modes:

- Manual: sync only on explicit user request.
- Balanced: sync on launch, foreground activation, and explicit refresh.
- Near real-time: Balanced plus foreground polling with jittered interval and backoff.

Near real-time polling must pause or stretch intervals after `429` and `5xx` responses.

## Offline Mutations

All writes should go through a mutation queue:

- assign local mutation id
- validate input
- write optimistic local state
- enqueue Google operation
- attempt when online and authenticated
- reconcile with Google response
- record failure and retry policy

If a write cannot be represented in Google, it must be local-only and clearly labeled in the model/spec before implementation.

## Conflict Strategy

V1 default conflict behavior:

- Google response wins for synced fields after a successful remote write.
- Pending local mutations keep their optimistic state until applied, failed, or cancelled.
- If remote state changes before a queued local mutation applies, the mutation service must re-read current mirror state and either apply safely or surface a recoverable conflict.

Do not silently drop user writes.

## Backoff And Error Handling

Required behavior:

- Use exponential backoff with jitter for rate limits and server errors.
- Treat auth errors as account-action-required.
- Treat invalid sync tokens as full-resync-required.
- Surface recoverable sync issues in the app status banner and diagnostics.
- Keep sanitized per-resource sync status in SQLite.

## Tests

Required tests:

- OAuth status serialization excludes tokens.
- Google transport mocks cover success, `401`, `403`, `404`, `409`, `410`, `429`, and `5xx`.
- Tasks initial sync and incremental sync update local mirrors.
- Calendar initial sync and incremental sync update checkpoints.
- Invalid Calendar sync token triggers full resync for that calendar.
- Offline mutation queue retries and reconciles a successful Google response.

## Current Implementation Notes

- Read-sync service diagnostics and progress events store resource names, counts, durations, retry delays, and sanitized error codes only.
- Task, task-list, and calendar-event UI writes now share SQLite-backed domain services with MCP tools. Those services apply optimistic local mirror changes and insert rows into `google_pending_mutations`.
- Pending mutation behavior is consistent for task and event writes: successful local writes return queued acknowledgements or queued detail DTOs, pending counts come from SQLite, and Google reconciliation is owned by a main-process `GooglePendingMutationWorker`.
- The mutation worker drains due task, task-list, and calendar-event mutations when write transports are supplied, transitions rows through `applying`, `applied`, and `failed`, records retry/auth diagnostics, and is not exposed through renderer or preload APIs.
- Core `sync.status` and `sync.runNow` IPC handlers remain startup-safe. They do not perform Google network work during app startup.
- macOS preview builds now wire bring-your-own Desktop OAuth client setup through Settings, PKCE loopback browser handoff, token exchange/refresh transport, Keychain-backed Google token storage, sanitized Google status IPC, latest connected-account transport selection, and a small manual/balanced/near-real-time scheduler.
- `sync.runNow` uses authenticated Google Tasks/Calendar read transports once a connected account and Keychain token are present; cached notes and settings remain usable when Google setup is skipped.
- Runtime Google writes are wired by default for connected accounts. Task, task-list, and calendar-event CRUD uses the shared mutation queue, authenticated Google write transports, and reconciliation through `GooglePendingMutationWorker`.
- Remaining sync hardening before broad release: live-account manual QA, conflict recovery UX, clearer account email/profile display if narrower scopes do not identify the account, and package-level verification that native SQLite remains active in signed/notarized builds.
