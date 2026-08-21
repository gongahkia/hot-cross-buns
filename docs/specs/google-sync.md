# Google sync specification

## Authentication

HCB uses a user-supplied Google OAuth **Desktop app** client, PKCE, and a
temporary `127.0.0.1` callback. The client JSON path comes from
`HCB_GOOGLE_CLIENT_CONFIG` or local preferences. Refresh tokens are stored in
the OS keyring; access tokens remain in memory.

Scopes cover identity/email, Google Tasks, Google Calendar, and read-only Drive
metadata. Drive access is used only for user-initiated metadata search. Tokens
must never be stored in SQLite, configuration, output, logs, or diagnostics.

## Local-first flow

Google is authoritative for synchronized fields. Local mutations validate and
update SQLite optimistically, enter a durable outbox, and are delivered in
creation order before remote changes are pulled. Retryable transport,
rate-limit, and server failures retain queued work with backoff and jitter.
Conflicting or uncertain deliveries remain visible for explicit recovery.

Google Tasks synchronization uses per-list update watermarks with an overlap to
avoid boundary loss. Calendar synchronization saves pages transactionally and
stores `nextSyncToken` only after the final committed page. A Calendar
`410 Gone` clears only that calendar's mirror/checkpoint and starts a full pull.

Updates and deletes use entity tags where available. `409`, `410`, and `412`
mutation outcomes become recoverable conflicts rather than silent data loss.

## Mapping rules

Google Tasks backs task lists, title, notes, date-only due value, completion,
hierarchy, order, and deletion state. Local-only metadata includes search,
presentation state, recurrence markers, mutation state, and links to timed
Calendar blocks.

Google Calendar backs calendars, events, all-day/timed values, recurrence
lines, resolved instances, reminders, attendees, status, location, and
description. HCB stores recurrence masters unchanged and uses Google's
instances behavior for concrete occurrences.

## Process model and validation

`hcb sync` is the explicit synchronization boundary. The optional reminder
process can perform configured periodic pull or full sync. The TUI and daemon
may coexist through SQLite WAL, bounded transactions, and single-writer
coordination.

Automated tests use fake transports for success and API failures. The live
Google TUI smoke procedure is separate. It was explicitly waived and not run
for the Python retirement pivot, so no live acceptance claim should be inferred
from the automated suite.
