# Sync behavior and recovery

Hot Cross Buns coordinates a browser journal with one plain-text target, either a [local sync folder](FILE_SYNC.md) or an optional [Google Drive file](GOOGLE_DRIVE.md). Nextcloud, Dropbox and Syncthing use the shared local folder transport; see [setup and provider validation](SYNC_FOLDERS.md). Protected folder links and new Drive links publish [immutable revisions](REVISION_SYNC.md) before updating the text file. Google authorization and the providers themselves are unchanged; our adapters add history-file capabilities. This page describes shared scheduling/recovery and the individual-file coordinator, which remains available with an explicit limitation notice.

## What the status means

- **Saved in this browser** describes a committed IndexedDB journal. A field still being edited is an unsaved draft; finish it before leaving.
- **Saving** means the linked file has remaining work. It can reflect an older saved journal while a new field is being edited.
- **Up to date** means the file matched the saved browser journal at the last check. It does not confirm receipt on another device or completion of Syncthing transfer.
- **Waiting** defers incoming changes while a journal field or mutation review is active in an app window. Scratchpad drafts and failed/queued scratchpad saves also defer incoming document replacement. Ordinary settings and search do not block integration.
- **Offline** and **retrying** retain durable browser work for later delivery. Temporary Drive failures and temporary missing, unreadable or locked folder files retry with jittered exponential delays, initially about 2 seconds and at most 72 seconds. Eight consecutive failures require manual resume. Permission failures and permanent disk errors require attention instead. A folder can receive local saves while its desktop client has no network connection.
- **Reconnect**, **allow access** and **review** require the indicated action in Settings. Google sessions belong to individual tabs; a valid session in another visible tab can keep delivering.

Visible tabs check local files about every 1.5 seconds and Drive metadata about every 15 seconds. Saved journal changes also schedule a check after about 750 ms. Returning to the tab or going online schedules catch-up. Background tabs do not start automatic checks, although a request already in progress may finish. Closed browsers cannot sync. Finish editing and wait for file delivery before switching devices, then let the transfer tool finish.

## Single-file delivery protocol

1. Load the saved journal, target, confirmed baseline and delivery ledger together. One browser Web Lock owns delivery across same-origin tabs; closing the owner releases that lock. There is no time-based leader lease.
2. Read the file before writing. Compare browser and file changes with their common baseline. Malformed input, unsafe projection sizes, ambiguous identity or overlapping edits require review. Independent changes can merge automatically.
3. Commit a frozen submission and its baseline to IndexedDB **before** sending it. Mark it uncertain before dispatch. If checkpoint storage fails, do not send. Local database transactions and journal/link-control locks finish before file or network I/O begins.
4. Send that frozen text. Local edits, undo and link changes can proceed while I/O is pending; they do not mutate the submission.
5. Read the actual file back. A transport response alone is insufficient. Commit the acknowledged baseline and retire the matching checkpoint together. A later local edit remains queued rather than being replaced by the receipt.
6. After a lost response, failed receipt transaction, reload or owner closure, read first. If the file matches the checkpoint, acknowledge it without sending it again. Otherwise reconcile the observed file with the saved journal. A known rejected write and an unknown outcome have different merge baselines. A reconnect failure during verification leaves the earlier write uncertain.

Conditional-write races re-read and reconcile up to three times per cycle, then require review. Retry cooldowns and failure counts survive reload; an implausible future cooldown caused by clock rollback does not suppress delivery indefinitely. Manual resume resets the retry budget. A target generation fences obsolete receipts after unlinking or accepting a review; an old request cannot recreate that link in browser storage.

Google file creation has its own durable ticket, separate from ordinary saves. An uncertain creation is never automatically repeated. The user can reconnect to the same account and choose the created file, download the submitted snapshot, or explicitly allow another creation after inspecting Drive. This is necessary because the API does not provide an app-owned idempotency key for this flow.

## Single-file merging and shared editing safeguards

The following field-level merge policy describes single-file mode. Protected history automatically integrates validated linear descendants; concurrent revision branches require explicit review. See [revision merging](REVISION_SYNC.md#publication-and-discovery). Both modes retain the same draft, undo, recurrence and atomic-review safeguards.

Planner.md uses stable entry IDs in readable fenced metadata. Source is authoritative; task projections are never passed through the TXT merge. Conservative source merging preserves disjoint edits when they do not touch the same semantic field. A title is atomic; completion/metadata/detail-checkbox changes share a progress group, detail titles are separate, and the scratchpad is atomic. Complete simultaneous entry insertions can combine only with distinct stable IDs and a valid resulting document. Overlaps, structural ambiguity and identity changes require review. Recurrence advancement is validated as part of the same source transaction. See [source review and recovery](MARKDOWN_RUNTIME.md#conflicts-and-recovery).

Incoming integration takes an exclusive, nonblocking editor lock. Focused journal fields and mutation dialogs hold shared editor locks across tabs. Outgoing persisted work can still be delivered while a newer field is being edited. Safe local undo/redo entries are rebased over incoming changes; ambiguous older inverses are retired instead of restoring stale remote values. Rebase work has a 100,000-row budget and keeps only a safe contiguous history suffix. This is not a synchronized undo history.

Review rechecks the raw file before approval, then atomically checks the saved browser journal and target generation while committing the journal, baseline and link. A stale review or failed transaction leaves those values unchanged. Downloading a recovery copy does not advance a baseline. Manual imports and downloads retain their own baseline, separate from the linked target.

Settings retains one browser/file comparison pair while that target remains linked. A new comparison replaces it. The ledger also remembers up to three recently submitted/baseline texts, with a combined 5 MiB cap, to route known older file echoes through review. An intentional external rollback can look like a delayed save, so it also needs review. These bounded copies are recovery aids, not backups or a full history archive. A pending submission and the latest comparison pair each have their own bounded file contents.

## Storage and credentials

Journal, link, confirmed baseline and checkpoint transitions use short IndexedDB transactions. The database retains its name, `hot-cross-buns-v1`, at internal schema **4**. Canonical source rebuilds derived arrays on load. Old TXT state, scratchpad, handles and pending records are archived under `legacy-txt:` and require an explicit workspace choice; targets are not silently renamed or relinked. See [transition and rollback](MARKDOWN_RUNTIME.md#earlier-developer-workspaces-and-rollback).

A rollback needs the version-4 opener, exact-source state/baselines, shared scratchpad transactions and revision protocol **2** support, including protected-target guards and durable retry identities. Previous version-3 compatibility commits alone are insufficient. Preserve pending outcomes, the browser archive and remote history; do not delete or downgrade storage to make earlier code load.

Access tokens remain in tab memory, outside the ledger, BroadcastChannel and browser storage. Other tabs receive change notifications and reload durable state; credentials are not broadcast. Google account identity is checked against the linked target or pending creation. Scratchpad text is shared in the Markdown document; appearance and local view preferences are excluded from file sync.

## Limits

The last external check and projection write are not universally atomic. Protected writers first preserve their snapshots in immutable files; individual-file mode retains the overwrite risk without that history. Strong Drive ETags are used when available, without relying on them for revision correctness. A generation check cannot cancel an already accepted external write; it fences subsequent app state changes. Neither mode can recover an arbitrary external editor version overwritten before it was observed.

Use one editing device at a time, retain provider version history or backups, and inspect Syncthing conflict files. The app does not resolve those separate files automatically. Offline browser storage can also be cleared or evicted; a local working copy is not an independent backup. Imports and file payloads retain the existing 5 MiB / 100,000-line limits. Visible projection limits still apply. There is no hosted change log, background agent, cross-device lock, push notification service or claim of equivalence to Things Cloud.

## Historical basis

The calendar-era snapshot at [`cab0383`](https://github.com/gongahkia/hot-cross-buns/tree/cab0383/docs) documented the earlier Things-inspired work. Relevant precedents include [`a88a532`](https://github.com/gongahkia/hot-cross-buns/commit/a88a532) for durable baselines, [`406297d`](https://github.com/gongahkia/hot-cross-buns/commit/406297d) for releasing local writers during HTTP, [`c7706aa`](https://github.com/gongahkia/hot-cross-buns/commit/c7706aa) for late receipts, [`b49aa1f`](https://github.com/gongahkia/hot-cross-buns/commit/b49aa1f) for conservative merging, [`0ef7655`](https://github.com/gongahkia/hot-cross-buns/commit/0ef7655) for uncertain outcomes and [`8d86976`](https://github.com/gongahkia/hot-cross-buns/commit/8d86976) for tab-scoped expiry. The journal applies those principles to one portable text file rather than restoring the calendar app's server model.

## Verification

`tests/journalSync.test.mjs` exercises the pure coordinator with fault injection: failed checkpoints and receipts, lost replies, undo during delivery, newer edits, independent and conflicting fields, ambiguous identities, stale echoes, changed generations, offline recovery, clock rollback, retry exhaustion and bounded undo rebasing.

`tests/file-sync.spec.ts`, `tests/google-drive.spec.ts` and `tests/save-recovery.spec.ts` exercise real browser storage, shared Web Locks, reloads, cross-tab drafts, stale/failed reviews, schema upgrades with file handles, owner handoff, delayed HTTP, offline transitions and unconfirmed creation. Local-file tests use real browser file handles with substituted OS pickers. Drive tests replace sign-in, Picker and HTTP with controlled responses. Run `npm run verify` for the complete project checks.

These finite checks establish the app's behavior under the injected scenarios. Actual Google account setup, provider guarantees, Syncthing transfer, native file-picker permissions and simultaneous physical-device edits require separate validation. Dogfood lost connectivity during saving, close the delivering tab, reconnect a different tab, edit the file externally, and inspect both copies after a real conflict before relying on a new device workflow.

`tests/sync-folder-providers.spec.ts` adds isolated browser journals with native browser-local handles and simulated Nextcloud/Dropbox folder transfers. Assertions wait for durable revision publication and journal/frontier convergence, rather than trusting an old status label. `tests/fileRevisions.test.mjs`, `tests/linkedFile.test.mjs` and `tests/syncFolderCheck.test.mjs` cover the shared folder contract and read-only on-disk receipts. Actual Nextcloud/Dropbox clients, credentials, native pickers and physical devices remain unverified; no cloud acknowledgement is inferred from a local file write.
