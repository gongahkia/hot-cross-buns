# Google Sync Spec

## Scope

Hot Cross Buns 2 syncs with Google Tasks and Google Calendar. Google remains the synced source of truth for tasks and events. SQLite stores local mirrors, settings, checkpoints, and pending mutations.

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

Time-specific task scheduling must be represented as a calendar event, not a Google Task due time.

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

