# Immutable journal revisions

Revision history protects participating Hot Cross Buns writers from replacing each other's only shared copy during the last-check/write interval. A verified immutable snapshot is published before updating `TODO.txt`. Another device can replace that text projection, but the app-authored snapshots remain separate files for later discovery and review. This is a recovery and convergence protocol, not an atomic lock on the shared text file.

## Enable and migrate

- **Local files:** choose **Settings → File sync → Link sync folder**. The folder contains `TODO.txt` and `.hot-cross-buns/`. Grant access to the entire folder and transfer both through Syncthing. A linked individual file can use **Enable folder revision history**; select its actual parent folder. A mismatched folder is rejected. Upgrading retains the existing journal, file, handle and link.
- **Google Drive:** new links enable history. An older link can choose **Enable Drive revision history**. Additional `HCB-<journal-file-id>-<revision-id>.json` files are created in My Drive using the existing `drive.file` scope. They contain full journal snapshots and consume Drive storage. These are ordinary app-created files, separate from Drive's built-in file revisions. Use the **same Web OAuth client ID and Google account on every device** so the same app can access its private properties and files. Changing the OAuth application or mixing accounts is not a supported history migration.
- **Single-file compatibility:** individual local-file links and older Drive links remain available, explicitly labeled as having no shared history. They retain the old whole-file race. They cannot gain revision protection without the folder grant or Drive upgrade. Upgrade all devices that will participate; older apps and external editors do not publish this protocol.

The first revision on a newly linked browser captures its saved journal. If another browser already has history, the new root is treated as a concurrent branch. Choosing **Review linked file** or **Review Google Drive file** acknowledges that branch through the normal import review. Identical text may need no per-item choices; accepting different contents remains explicit.

## On-disk format

Local history lives under `.hot-cross-buns/<SHA-256 of the exact journal filename>/<revision UUID>.json`. Selecting a new sync folder uses `TODO.txt`. Existing custom filenames can upgrade in their own folders; preserve their exact names and the corresponding history directory when transferring or archiving.

Each UTF-8 JSON envelope has exactly these fields:

```json
{
  "protocol": 1,
  "journal": "file:TODO.txt",
  "id": "a revision UUID",
  "device": "a persistent browser-profile UUID",
  "parents": ["sorted, distinct parent revision UUIDs"],
  "origin": "journal",
  "text": "the complete portable TODO.txt contents",
  "digest": "SHA-256 of the canonical envelope without digest"
}
```

The example describes field meanings, not a valid record. Drive uses `drive:<journal-file-id>` as its journal namespace. `origin` is `journal` for saved app state or `external` for observed text-editor contents. IDs, origins and parent references are included in the checksum. Checksums detect altered bytes; they are not signatures or an authorization system. Users with storage access can edit or delete files. The coordinator never updates a nonempty existing revision. A UUID filename collision with different contents or two differing envelopes with one logical ID pauses saving.

`TODO.txt` itself gains no new metadata or private item IDs. It remains readable, importable and downloadable in the existing [format](TODO_FORMAT.md). While history is enabled, the journal's recoverable meaning includes its revisions and unresolved branches; the latest text projection alone is insufficient to recover every concurrent edit.

## Publication and discovery

1. Load the durable journal and the link generation. Freeze a revision with the parents the browser had actually integrated, before discovering new remote branches. A local edit must not claim unseen changes as its ancestors.
2. Save the complete pending envelope and transport identity to IndexedDB before publication. Local editors remain available during transport I/O. Edits or undo after this point remain queued and are not included in the frozen receipt.
3. Publish and read back that exact revision. A local revision uses its stable UUID filename. Drive first reserves a file ID, persists it with the envelope, then creates that ID; a retry receiving `409` reads and checks the existing file instead of generating another identity. A failed checkpoint sends no revision. A lost reply or failed receipt keeps the same pending identity through reload or tab handoff.
4. Enumerate and validate history: protocol, namespace, identity, checksum, limits, parent availability and acyclic ancestry. Identical logical copies coalesce. Listing order and timestamps do not decide winners. Known heads cannot disappear silently, and missing ancestors or incomplete listings pause projection writes and retry. A browser cache is not a substitute for a missing history file.
5. A validated linear descendant may integrate through the existing conservative import merge and view limits. Concurrent heads require explicit review, even when their fields might be independently mergeable. Review combines two snapshots at a time. Approval records only the selected branch and previously accepted frontier as parents; an unreviewed third branch remains pending. The next publication records the chosen result as a new immutable merge revision.
6. After the observed branches have been integrated or reviewed, update `TODO.txt` using the existing checked whole-file writer. The write still has a physical race, but participating app writers have already retained their snapshots. Read back the projection before reporting it as current. Explicit rejections and uncertain receipts keep different review baselines.

There is no mutable head manifest, shared append file, timestamp lease or cross-device lock. Browser Web Locks serialize same-origin delivery only. Old or closed owners cannot recreate a replaced link in local storage. Credentials stay in tab memory; an expired session in one tab does not disable other authorized tabs.

Drive discovery follows all pages, including empty pages with continuation tokens. An `incompleteSearch` result, repeated token, excessive pagination or malformed metadata pauses saving. Verified bodies can be cached by provider file ID and version, with the logical identity and checksum checked against app properties. A missing listing entry is never accepted merely because its body was previously cached. Listings may discover a new concurrent branch later; **up to date** describes the latest checked projection and observed history, not receipt by every device.

## External text editors

If a checked `TODO.txt` contains newly observed text different from its confirmed projection and the current journal, the coordinator freezes an `external` revision before replacing it. Its parents refer to the last confirmed projection rather than a newer local edit. Text matching an older revision or a pre-upgrade submitted payload is ambiguous between a delayed write and an intentional rollback, so it becomes a separate root requiring review. A matching uncertain projection submission is verified as its pending receipt instead. Malformed text is retained and goes through the doctor; repairs require explicit approval. The normal recovery comparison downloads remain available, without advancing the baseline.

An external edit overwritten before any participating app observes it cannot be reconstructed by this protocol. Editing only `TODO.txt`, deleting companion history, using an older app, or running a writer that ignores revisions remains outside the app-to-app protection. Syncthing conflict copies should be retained and inspected. Do not delete or hand-edit history envelopes to resolve a journal conflict; use the app's review flow.

## Bounds and retention

Snapshots retain the existing **5 MiB / 100,000 logical line** text limit. A graph is bounded to **1,000 logical revisions / 64 MiB** of canonical envelopes, and ancestry traversal has a **1,000,000-step** budget. Transport scans also bound physical files and actual bytes, including duplicate copies, so they can stop before the logical count shown in Settings. Known full history blocks another publication before reserving an identity. Concurrent devices can each publish before discovering that the combined history exceeds a bound; projection updates then pause. No data is pruned automatically to make the check pass.

Full snapshots deliberately trade storage for a small, inspectable first protocol. Settings shows observed revision count and size. At the limit, export the current journal and archive **all** history, including unresolved branches. Bring devices online and review their changes, then explicitly unlink the old target and start a new folder or Drive journal file. Link the new target on the other devices. Keep the old archive for any device that was absent: its later changes still belong to the old history and need review/import into the new journal. There is no safe automatic expiration for an arbitrarily offline device in this version.

Automatic compaction would require a separately designed acknowledgement and retention protocol. It is a follow-up, not an implicit promise of this implementation. Provider quota failures pause saving while retaining local work and pending identity. Browser storage can be cleared or evicted; retain independent backups.

## Storage upgrade and rollback

The browser database keeps its name `hot-cross-buns-v1` and upgrades its internal version to **3**. Existing version-1 and version-2 journals, scratchpads, baselines and file handles are retained. Older incompatible writers cannot reopen it. Finish or export drafts in older tabs before reloading. The Shio Pan migration still opens the destination without downgrading its schema.

Compatibility commit [`8e74d5e`](https://github.com/gongahkia/hot-cross-buns/commit/8e74d5e) retains the version-3 opener and a guard that blocks a coordinator without revision support from writing a protected target. Keep that compatibility floor when rolling back the revision implementation. An older coordinator that merely opens version 3 still must not write revision-enabled links. It should show the update/unlink/export error and allow local journal recovery. Never delete the database or lower its version to force a rollback. Preserve pending envelopes, creation tickets and the complete remote history until their outcomes are resolved.

## Verification and provider references

`tests/linkedFile.test.mjs` reproduces the legacy last-read/close overwrite. `tests/revisionSync.test.mjs` injects that race between two independent device stores and verifies that both revisions remain represented and require review. It also covers offline branches, delayed discovery, missing history, failed checkpoints/receipts, lost replies, stable identity on restart, newer edits and undo, active drafts, relinking, rejected writes, integrity failures and retention limits.

`tests/revisionDrive.test.mjs` tests reserved IDs, retry/409 read-back, pagination, empty pages, incomplete searches, duplicate logical records, metadata/body mismatches and scan limits. Browser tests exercise real IndexedDB and native browser file handles with substituted pickers, plus mocked Google authorization and HTTP, through the actual UI and recovery flow. Run `npm run verify` for the complete checks.

Actual Google OAuth configuration, private-file access across physical devices, native picker permissions and Syncthing transfer remain separate validation. The protocol is not a claim of equivalence to Things Cloud.

- [Google Drive pre-generated file IDs and retry behavior](https://developers.google.com/workspace/drive/api/guides/create-file#generate-ids-to-use-with-your-files)
- [Drive pagination and incomplete searches](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [Drive private app properties and their limits](https://developers.google.com/workspace/drive/api/guides/properties)
- [File System directory iteration and writable streams](https://fs.spec.whatwg.org/)
- [Syncthing scanning, conflict files and temporary writes](https://docs.syncthing.net/users/syncing.html)
