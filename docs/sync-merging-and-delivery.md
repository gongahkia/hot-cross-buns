# Field merging and outgoing write reduction

Work started 2026-10-29. This extends the existing shared sync engine; it does not introduce another backend or authoritative task store. Implementation is in progress. The merge model alone does not enable automatic merging in the running application.

## API evidence

Google Calendar supports conditional writes using the last observed ETag. A stale version returns HTTP 412; recovery requires fetching the resource again and deciding whether the local intent can be reapplied. Inserts instead rely on resource ID uniqueness. We retain conditional writes and bounded retries. [Calendar resource versions](https://developers.google.com/workspace/calendar/api/guides/version-resources).

Google's partial-update contract leaves omitted fields unchanged. Explicit null removes an optional field; a supplied array replaces that complete array. Consequently, attendees, attachment lists and reminder overrides cannot be independently patched by array index. Task notes and HCB metadata are merged locally and serialized back into the one notes field. [Tasks performance and PATCH semantics](https://developers.google.com/workspace/tasks/performance).

Calendar PATCH consumes three quota units. Narrow patches reduce payload size and avoid overwriting unrelated properties, but do not themselves reduce the quota cost per request. Combining compatible writes and eliminating writes whose desired state is already present reduce request count. [Calendar events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).

## Intended invariants

- Persist the last observed remote version separately from optimistic local state. Track the fields changed locally against it. Never manufacture a remote baseline from an already-edited local row during migration.
- Compare base, local and remote values. Independent changes merge; equal concurrent changes converge. Different changes to the same field require the existing explicit comparison/recovery flow.
- Compare Calendar start/end/timezone together, task planning fields together, and arrays as complete values. Changes to a recurring series, remote deletion or structural location/order remain review boundaries when versions diverge.
- Freeze each outgoing submission and its selected mutation IDs before releasing the workspace lock. A later edit or undo must not be acknowledged by an earlier response.
- Combine only adjacent compatible, unsent commands within one account. Never cross a move, delete, reorder, recurring operation, retry or conflict. Preserve individual undo entries and use field-scoped inverses for updates.
- Persist accepted receipts and their baseline with acknowledgement. Retain enough submission information to distinguish a lost response from a later local undo when recovering.
- Do not treat a missing baseline or missing ETag as permission to overwrite Google. Reviewed recovery must establish a new baseline before retrying a conflict.

## Verification status

The pure merge model has 20 passing tests covering independent and overlapping changes, convergence, task metadata, explicit clears, date normalization, related time fields, arrays, unmanaged attachments and structural review boundaries.

Schema 10 stores remote baselines and dirty fields in `google_sync_state`, with a separate `sync_intent_json` snapshot on each new outbox command. Pulls and accepted receipts capture their actual remote/submitted version; newer local edits stay dirty. Migration preserves legacy outbox payloads and undo history, leaves their unknown snapshots null, and does not invent a baseline from optimistic content. Task/event body construction is shared between delivery and tracking.

All 151 database/integration cases pass, including nine new restart, migration, account-isolation, ordering and late-receipt cases. The existing 23 service and 13 concurrency cases also pass, as does the core TypeScript check. Automatic merge application, delivery/recovery integration, coalescing, and browser regressions remain to be implemented and verified. No live Google account has been modified.

Update undo entries now retain only affected fields (including related date/reminder/planning groups). Older whole-record entries are scoped when executed, so unrelated remote edits survive both undo and redo. Task reorder history includes the previous sibling needed to restore ordering. Four additional regressions pass alongside all 68 CoreStore and 13 concurrency cases; the core TypeScript check passes.

## Outgoing delivery increment

Ordinary Task, Task-list and nonrecurring Calendar creates/updates now use their queued snapshots. Adjacent compatible updates combine into one request; updates can fold into an unsent creation. An intervening item, move, reorder, deletion, recurring operation, retry or unknown legacy intent stops the batch. Changed-field patches preserve unrelated Google fields, and an unsent edit followed by undo can finish without HTTP. Individual undo history remains intact.

Before HTTP, the existing operation-metadata store saves the exact selected mutation IDs, baseline, target, request body and local submission snapshot. A late response acknowledges only those IDs. A subsequent edit/undo stays queued, and restarting retains the original submission. Reviewed recovery clears obsolete submissions and establishes the ETag from the reviewed snapshot; it cannot silently replay an old batch over the reviewed decision. Calendar moves also retain their actual intermediate receipt location.

The request-count tests verify one narrow PATCH for adjacent edits, one POST for create-plus-edits, no write for edit-plus-undo, continued delivery after a batch, and ordering across another item's command. They also verify Calendar clears preserve guests/reminders and a newer edit during HTTP remains pending. The existing 68 CoreStore, 13 concurrency and expanded integration tests pass, alongside 18 durable-state and 14 batch-selection tests. A Calendar timezone-cache defect found by narrow-patch testing is fixed: a description edit no longer silently changes an omitted timezone.

Automatic incoming merge application, bounded 412 rebase/retry, ambiguous receipt recovery against a fresh remote observation, legacy-base discovery and the final browser/full-suite audit remain in progress. Structural operations retain their existing delivery/review paths at this stage.
