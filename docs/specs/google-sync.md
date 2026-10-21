# Google Sync Spec

## Scope

Hot Cross Buns 2 syncs with Google Tasks and Google Calendar. Google remains the synced source of truth for tasks and events. SQLite stores local mirrors, settings, checkpoints, and pending mutations.

Drive and Gmail are optional, user-authorized helper integrations rather than sync sources. Drive searches metadata for existing files and may upload a local file only after the user selects it from HCB's native picker; the upload is placed in the user's private `Hot Cross Buns attachments` folder and HCB inserts its Drive link into a task or event description. HCB never downloads, moves, shares, or deletes Drive files. Gmail is used only to search selected message metadata/snippets and explicitly capture one message as a Task; it never sends, archives, labels, or deletes mail.

## OAuth

Use a desktop OAuth loopback flow. OAuth client configuration must support bring-your-own-client for preview builds.

Token rules:

- Access and refresh tokens must be stored in the OS keychain.
- Tokens must never be stored in renderer state, localStorage, sessionStorage, logs, SQLite, diagnostics, or MCP responses.
- Renderer may receive sanitized connection status only.
- OAuth errors must be translated into user-actionable messages.

Credential changes serialize the complete read/modify/write of the encrypted envelope. Refreshes for one account share an in-flight request; different accounts may refresh concurrently and merge into the latest envelope. A completed refresh must not restore a disconnected or replaced authorization. A late `401` reuses a newer token when another request has already refreshed the rejected one. Failed writes leave the previous envelope intact and do not block later saves.

## Scopes

Required Google scopes:

- `https://www.googleapis.com/auth/tasks`
- `https://www.googleapis.com/auth/calendar`

Optional scopes are requested only after the user selects the corresponding control in **Settings → Profile**:

- `https://www.googleapis.com/auth/drive.metadata.readonly` for Drive-link attachment browsing
- `https://www.googleapis.com/auth/drive.file` for explicitly selected local-file uploads. This is requested separately and creates/manages only files HCB uses.
- `https://www.googleapis.com/auth/gmail.readonly` for Gmail-to-Task capture

The client must not silently broaden an existing grant. See [Google Workspace integrations](../google-workspace-integrations.md) for consent, verification, and live-test requirements.

### Reconfiguring optional access

Desktop OAuth cannot selectively withdraw an already-granted scope. **Settings → Profile → Reconfigure Google access** therefore presents the optional capabilities for one connected account, requires an explicit acknowledgement, and starts a replacement consent flow with exactly the selected optional scopes. Before revoking the current authorization, the main process blocks the operation if that account has pending or conflicted outbox mutations. A successful reset deletes the encrypted account credential, marks the cached account disconnected, preserves the local Task/Calendar cache, and opens the default browser for a fresh PKCE authorization. The UI warns that another HCB installation using the same OAuth client may also need to reconnect. The renderer receives only sanitized status and never a token or revocation response.

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

Queued task-list renames retain their local title and original ETag during pulls. An externally changed list becomes an explicit conflict; choosing to retry the local rename clears that stale revision intentionally.

Task updates send empty note text explicitly and use `due: null` to clear a date; a new undated task omits `due`. This follows [Google's PATCH semantics](https://developers.google.com/workspace/tasks/performance#semantics_of_a_patch_request). HCB planning metadata, when present, remains in the task notes even when the user clears the visible prose.

Explicit sibling reordering uses Google's `tasks.move` endpoint, including moving to the first position by omitting `previous`. Ordinary content edits do not reposition a task. A cross-list move is followed by a content update against the returned task identity and ETag so a combined move/edit retains both changes.

An initial or forced full Tasks pull includes completed, hidden, and deleted tasks. After every page succeeds, cached Google tasks absent from that list's snapshot become local deletion tombstones. Pending/conflicted edits and unbound local creations survive. A failed full pull or an incremental `updatedMin` delta must not delete tasks merely because they were absent from the response.

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

After every page of an unfiltered full Calendar pull succeeds and returns its final sync token, remove cached Google events absent from that snapshot. This also applies to an explicit full resync and recovery from `410 Gone`, as required by [Google's synchronization guide](https://developers.google.com/workspace/calendar/api/guides/sync). Preserve local creations and events with pending or conflicted writes. Failed or incomplete pulls must not prune absent events or advance the checkpoint; incremental deltas must never prune unchanged events. Removing an absent scheduled event uses the same transactional block unlinking as an explicit cancellation.

Remote event cancellations remove linked local task blocks in the same transaction before deleting the event. The task remains intact; its planning times reflect a surviving block or are cleared. Pull reconciliation does not enqueue a compensating Google write.

For connected primary calendars, Calendar status events support Focus Time, Out of Office, and Working Location. HCB supports signed-in-user RSVP edits, read-only free/busy lookup, Google Meet creation requests, existing Drive-link attachments, and private uploads of user-selected local files. It does not support Calendar Goals, organizer-side guest or resource booking, conference removal, Drive download, sharing, moving, deletion, or a broad Drive file-lifecycle feature.

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

Queued writes follow SQLite insertion order within each account, including edits created in the same millisecond. A deferred or conflicted write blocks later writes for that account across sync runs and restarts; other accounts can continue syncing. A lost response to a non-idempotent Task or task-list creation requires explicit conflict resolution rather than an automatic second creation. Outstanding conflicts remain visible as an error after a successful read refresh.

Before sending a non-idempotent creation, the queue durably marks it as started. Startup recovers an interrupted creation as a conflict, including a process exit after Google accepted it but before HCB recorded the response. Server failures and unreadable responses also require review when a creation may have been accepted. A definitive rejection such as a rate limit retains normal backoff behavior.

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
