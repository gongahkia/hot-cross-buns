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

## Incoming merge and conditional retry increment

Pending Task, Task-list and Calendar rows now compare their baseline, local state and incoming remote state. Independent fields merge and equal changes converge; overlapping fields retain both versions for explicit review. A reviewed conflict cannot be bypassed by clearing its ETag through quick retry. A legacy row without a baseline can establish one when its stored ETag proves the incoming resource is that same version; a divergent or missing version requires review.

HTTP 412 triggers a fresh resource read and a bounded conditional retry, with at most three PATCH attempts for that submission. Retries retain the original mutation IDs, so an edit arriving during the fresh read stays queued. Incoming deletes and concurrent structural/recurring changes remain review boundaries. Ordinary updates to an unchanged recurring series can use narrow patches, but are never combined with other commands.

An incoming resource that proves an earlier submission reached Google can acknowledge just that submission. Newer local work is compared with its submitted target, preserving an undo across a lost response and restart. Ambiguous overlapping changes still require review. Successful receipts apply server-normalized fields only where the user has not edited them again, and save the receipt with acknowledgement in one SQL transaction. If an unsent edit/undo cancels itself before an independent phone change arrives, the final queued field intent is rebased too; it cannot replay a stale undo over the merged phone value.

The expanded integration suite has 85 passing cases, including Tasks and Calendar field merging, task notes versus metadata, convergence without writes, bounded 412 retries, edits during the retry read, explicit deletion/series review, server normalization, and cleared metadata. All 22 durable-state and 13 concurrency cases pass; the pure merge model's 20 cases and the core TypeScript check also pass. Full-suite/browser validation and audits of structural delivery, legacy queues, imported submissions, and recovery edge cases remain outstanding. These are mocked Google tests, not live-account validation.

### Task metadata compatibility

The first full-suite run passed 555 tests and exposed one existing behavior that needed preserving: a Google client editing plain notes may omit HCB's metadata footer. Absence continues to retain previously known HCB planning values. Clearing metadata from HCB now sends an explicit defaults footer, which another HCB instance can distinguish from that plain-text edit. Baselines retain the wire notes and mark when metadata was retained, rather than implying that an absent footer still contains those values. A fresh device cannot recover removed metadata without a prior local baseline; this is a limitation of storing HCB-only fields in Google's notes.

The compatibility fix passes 214 focused cases, including the existing metadata-retention regression and new tests for explicit resets and independent phone note edits. The actual encoded PATCH body is checked against Google's notes limit, including the defaults footer. The full suite and browser audit will be repeated after the remaining delivery checks.
