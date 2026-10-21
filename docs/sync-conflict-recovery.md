# Reviewing sync conflicts

Diagnostics → Sync → Compare and resolve fetches current Google content before
showing local and remote fields together, including task planning metadata,
parents/order, Calendar locations, guests, reminders, recurrence and attachments.
The decision names the number of
queued changes it affects. Related changes include later writes to the same
resource, task descendants, tasks in a resolved list, and recurring-series
successors and exception edits. Deleting a task list also includes its queued
Calendar block deletions. Other queued changes remain pending.

Use Google reads Google again, rejects a changed comparison, then cancels the
related queue entries and restores complete remote snapshots in one SQLite
transaction. The operation works even when an earlier incremental pull already
advanced past the remote edit, or the resource is outside the selected sources.
Deleted lists and events are restored with their stable local IDs. Newly deleted
lists retain task identities for this purpose. Old deletion entries created
before this change cannot reconstruct task IDs they never saved. Scheduling links
are restored with their stable IDs, and block times follow the restored event.
Discarded scheduling operations are removed from planner undo history.

Keep local explicitly clears stale revisions and queues the related writes.
Calendar move chains are rebased from the actual remote source to the latest
local destination, keeping their original position in the outbox. Google event
IDs are scoped to their calendars; equal IDs in unrelated calendars do not
participate in recovery. Pulls preserve an optimistic move without importing a
second local copy from its source.
Descriptions and notes in the comparison are inert text. Credentials, tokens,
Google identifiers and ETags are not sent in the comparison DTO.

## Guardrails and limits

- Lost task/list creation responses retain a durable uncertainty marker, including
  across a crash. Generic retry cannot bypass it. Use Google imports Google's
  current items and discards the unlinked local draft and dependent edits. Copy
  local text first if needed; matching a draft to an accepted creation is not
  guessed by title. An explicit remote-item adoption workflow remains future work.
- A partially completed recurring-series split must restore Google's actual
  state before a new split. Generic overwriting of a missing Google item is not
  offered. These comparisons retain the local content for copying.
- Comparisons expire after five minutes. A changed local queue, local resource,
  Google snapshot, or a concurrent sync rejects recovery without cancelling
  writes. Fetch/import failures preserve the queue and local state.
- Only fingerprints and local revision guards are cached for comparisons; complete
  account snapshots are released after each request. Reviews display at most
  20 items at a time, with the full affected count next to the decision buttons.
  Unchanged task descendants are not expanded into thousands of comparison rows.
- Recovery reads complete account snapshots for the affected API family, including
  unselected sources. This favors correctness for an infrequent recovery action;
  a large account or an unreadable Calendar can make comparison slow or fail.
- Keep local follows the existing sync mode: manual mode leaves it queued until
  Refresh. Use Google only reads Google and updates local state; it issues no
  Google create, update or delete requests.
- Refresh requested during recovery waits for that operation to finish, then
  performs a sync even if recovery failed. Shutdown waits for both operations.
- Legacy low-level cancellation resets checkpoints and cancels related entries;
  the reviewed recovery endpoint additionally restores remote content immediately.

## Validation

Local SQLite/integration coverage includes both recovery choices, later queued
edits, lost creation responses, list dependencies, stable IDs after deletion,
Calendar moves (including repeated moves and accepted moves with a lost response),
equal event IDs in different calendars, series splits, stale local/Google
comparisons, failed fetches,
and transactional import rollback. Renderer tests cover explicit review, affected
counts, inert content, blocked unsafe retry and preserving the review on error.
No live account or Google writes were used to run these tests.

The final combined release gate on 2026-10-21 passed production build and both
TypeScript checks, 207 unit tests, 116 native database/integration tests and all
9 Electron desktop tests. Unit coverage also verifies recovery IPC routing and
an explicit Refresh waiting for successful or failed conflict recovery.
The rebuilt unsigned macOS package also passed launch, SQLite/backup integrity,
deferred editor, native integration, restart and schema-upgrade checks using a
disposable installation and profile.


Calendar creation recovery also preserves local identity: only a matching
client-generated event ID and HCB private metadata can bind a previously unbound
local event. Pending local edits remain protected. Lost Google Tasks creation
responses do not have this identity mechanism and remain fenced as described
above. Repeated deletes returning 404/410 settle as removed; authorization and
revision failures retain their conflict.

Clearing an event's Markdown description now sends an explicit empty description
in PATCH, so an old description cannot return after the next pull. This follows
Google's documented [PATCH behavior](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch): omitted fields retain their previous value.
