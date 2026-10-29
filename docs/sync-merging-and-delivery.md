# Field merging and outgoing write reduction

Implemented 2026-10-29 in the existing shared `CoreStore` and `GoogleSyncService`. The browser still has one SQLite workspace and one sync engine. Final release validation is recorded below; these changes do not introduce a cloud backend or unattended mobile synchronization.

## Behavior

For Google Tasks, task-list titles and Calendar events, a persisted remote baseline is compared with local intent and a fresh Google version. Independent field changes merge automatically. Equal concurrent changes converge without an unnecessary write. Different changes to the same field retain the local content and require the existing Compare Google flow. Quick retry cannot discard a reviewed revision requirement.

Task title, notes, due date, completion, priority, tags, planning and snooze are compared independently where their API representation permits. Planning fields form one group. Calendar start/end/timezone form one group; attendees, attachment lists, recurrence and reminder settings are whole values. Arrays are not merged by index. Concurrent deletions, location/order changes and recurring-series changes stay explicit review boundaries.

A sequence of adjacent, compatible, unsent edits can become one conditional PATCH. Updates can fold into an unsent creation. A net-zero ordinary edit/undo can finish without HTTP. A different entity/account, move, reorder, deletion, recurrence command, attempted write, conflict or legacy command ends the batch. Original undo entries remain independent, and update inverses affect only the edited fields, including when executing older whole-record history.

## Durable data and submission boundaries

Schema **10** adds `google_sync_state` with the last observed remote projection, identity, collection, revision and local dirty fields. `outbox.sync_intent_json` captures each new command's snapshot and changed fields. Migration keeps older queues/history intact and leaves unknown snapshots null; it never invents a remote baseline from optimistic local content.

Before HTTP, the existing operation metadata saves the exact batch IDs, target, baseline, request body and submitted local snapshot. The existing worker checkpoint persists it before releasing the workspace writer. The Google operations lock preserves remote ordering while local edits remain available. Receipts acknowledge only the frozen IDs, bind identities/revisions, merge server normalization where no newer local edit exists, and update the baseline in the same SQL transaction. Browser persistence continues to use IndexedDB protocol v3.

A new edit or undo during HTTP remains queued. Recovery compares newer work with the frozen submission, so an accepted request followed by a lost response cannot swallow that undo. If a local edit and undo cancel out before an independent phone change arrives, the final queued field intent is rebased as well; it cannot later overwrite the merged phone value.

Ordinary write receipts with malformed/mismatched identities or missing revisions leave the submission available for recovery. A failed pre-send persistence checkpoint prevents the HTTP write. A failed receipt transaction rolls back both the baseline and acknowledgement. Retry backoff and the existing eight-attempt limit remain in effect; unresolved work blocks dependent writes within that account.

## Version races, legacy queues and explicit recovery

HTTP 412 triggers a fresh read and a three-way merge. A compatible result retries against the new ETag, retaining the original batch IDs, with at most three PATCH attempts. Overlapping or structural changes require review. A missing historical baseline requires a fresh read that proves the original version, otherwise review; a missing revision never authorizes an unconditional update or deletion. An already absent deletion target may be acknowledged without another DELETE.

Older commands without snapshots require comparison before sending. Choosing Keep local approves the current displayed state: ordinary legacy chains are replaced at their original queue position with that reviewed snapshot while keeping undo history. Older series splits cannot reconstruct their intermediate snapshots and stay available for comparison before a new split. Reviewed retries invalidate obsolete submissions; stale comparisons are rejected if local or Google state changes.

Calendar uses a reserved creation ID. A duplicate-ID response is followed by a read and a merge against the frozen creation, not blindly treated as server normalization. Reserved restoration IDs are recognized in comparison as well as pull recovery. Tasks creation still has no client-chosen ID in this integration: an ambiguous result requires linking/review instead of automatically creating a duplicate.

## Moves, meeting links and recurring events

Moves and reorders use their command snapshots. Content queued between two moves is sent at that position. A move receipt records its actual location/revision before a narrow content PATCH. An acknowledged move resumes its remaining content write; an uncertain move is checked at its source and requires review if the original version cannot be established. Structural operations are never coalesced.

Meeting-link creation is a singleton command with its own request data. Unchanged scalar event fields alone cannot prove that this command reached Google. Later title/content edits remain separate.

Generated occurrence edits retain the original projection and command snapshot. Delivery verifies the parent revision and the instance fields, freezes a narrow conditional PATCH, and retains changed/missing occurrences for review. It never substitutes a new standalone event for a disappeared occurrence. Recovery locates an unbound instance by series/original start without duplicating the local row. Undo restores the edited fields instead of cancelling that occurrence.

Series splits capture both parent and successor snapshots. Parent updates, compensation and exception copies send changed fields. Ambiguous remote results and later dependent local edits stop automatic compensation: a lost reply after an accepted truncation must not be called a successful rollback. Clear rejections retain the existing compensation path. Google does not offer one atomic API request for a whole series split, so interrupted multi-step results remain reviewable.

## API evidence

- [Calendar resource versions](https://developers.google.com/workspace/calendar/api/guides/version-resources): conditional modification uses the previously observed ETag; a stale revision returns 412. Inserts use resource ID uniqueness instead.
- [Tasks partial updates](https://developers.google.com/workspace/tasks/performance): omitted fields remain unchanged, null clears optional values, and supplied arrays replace the complete array. HCB task notes and planning metadata are merged before serialization into Google's single notes field.
- [Calendar PATCH](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch): narrow requests preserve omitted fields, but each PATCH still consumes three quota units. Combining requests and eliminating redundant writes reduces request count; smaller payloads alone do not reduce quota per request.
- [Calendar recurrence](https://developers.google.com/workspace/calendar/api/guides/recurringevents) and [instances](https://developers.google.com/workspace/calendar/api/v3/reference/events/instances): series and instances are distinct resources; instance lookup supports the original start time. HCB's conservative review and recovery choices are application behavior, not a claim of server-side transactional series edits.

## Verification

The complete unit suite passes **613 tests across 83 files**, including the fault tests. The separate database command passes **240 tests** (also included in the unit total). All **133 distinct browser scenarios** pass across the full run and targeted reruns described below. Coverage:

| Coverage | Evidence |
| --- | --- |
| Merge rules and batching boundaries | `src/shared/google/syncMerge.test.ts` and `syncBatch.test.ts` |
| SQL baselines, command snapshots, migration and undo | `src/main/services/googleSyncState.test.ts` |
| Real SQLite/service delivery, merging, ordering and reviewed recovery | `src/main/services/googleSync.integration.test.ts` |
| Injected failures with real SQLite/outbox/undo | `src/main/services/googleSyncFaults.integration.test.ts`: 51 passing scenarios covering lost/unreadable replies, HTTP failures, restart/undo, legacy commands, malformed receipts, failed SQL transactions, failed persistence, deletes, meeting links, occurrence recovery and uncertain series operations |
| Real workers, SQLite WASM and IndexedDB | Eight passing scenarios in `tests/browser/merge-sync.spec.ts`, covering both Tasks and Calendar across reload, closing a network owner, another tab's undo, conditional-write races, conflicts and stale review |
| Task editor acknowledgement race | `src/renderer/src/features/core/screens/tasks/useTaskInspector.test.tsx`: a late field edit after creation updates the saved identity instead of creating a duplicate; the test reproduced two creations before the fix |
| Existing responsive editing/storage boundaries | `tests/browser/responsive-sync.spec.ts`, storage safety, transfer, multi-tab and automatic-sync suites |

Validation completed on 2026-10-29:

- `corepack pnpm test:unit --maxWorkers=1 --minWorkers=1`: 613 tests pass. One worker was used to reduce contention with the browser run.
- `corepack pnpm test:db`: all 240 tests pass.
- `corepack pnpm test:ui`: the full run passed 129 of 133 scenarios. After correcting three test fixtures and fixing the task creation race, a fresh-build targeted run passed all four affected scenarios. This is coverage across runs, not a claim that the final full suite was rerun in one invocation.
- `corepack pnpm build`: both TypeScript checks and the production Vite build pass after the task editor fix. Existing chunk-size/deprecation warnings remain.
- `corepack pnpm test:production`: passes after the fix; mandatory Google account gate, durable local recovery and absence of production test hooks verified.
- `corepack pnpm test:offline`: all four production offline/update scenarios pass.

The browser fixture corrections respect the inert app shell during onboarding, establish the rich editor caret before indentation, and wait for the command-menu overlay to accept clicks. The task race was a product defect: a field event carrying pre-save editor props could revert a newly saved task to create mode. The controller now retains the acknowledged identity. The full unit suite was rerun after that fix. The first full-browser launch had timed out during competing builds; the subsequent full run started independently.

## Limits

These tests inject Google responses; they do not measure production Google latency, quota consumption, or phone-to-Mac convergence. No live account resources or deployment were changed. Finite fault tests cannot establish a universal no-loss guarantee. Browser storage eviction, physical disk loss, removed Google access and errors outside the tested failure model still require backups and recovery.

If a Google client removes the HCB notes metadata footer, previously known planning values are retained. A deliberate HCB reset sends an explicit defaults footer. Baselines keep the wire notes and whether metadata was retained. A fresh device cannot recover a removed footer without an existing baseline; ordinary Google notes are not a full HCB workspace replica.

Google synchronization remains sequential within its owner. Large local SQLite/snapshot operations still take the workspace writer lock. Authentication continuity, Calendar watch notifications, HCB Notes/preferences replication and native mobile background execution remain separate projects. `README.md` is unchanged.
