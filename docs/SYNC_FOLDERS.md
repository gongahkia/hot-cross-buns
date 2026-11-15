# Nextcloud and Dropbox sync folders

Hot Cross Buns supports Nextcloud and Dropbox through their **desktop sync folders**, using the same protected file transport as Syncthing. Each provider has a separate settings section with its logo, setup details and folder picker. Link one dedicated, locally available journal folder. The browser writes `TODO.txt` and immutable companion revisions; the desktop client handles authentication, cloud upload and device transfer. Enter Nextcloud server/account details or Dropbox sign-in in the corresponding desktop client, rather than in Hot Cross Buns. There is no new Nextcloud, WebDAV, Dropbox or OneDrive API connection in this release.

Automated tests exercise the app with real browser-local file handles and simulated transfer faults. **Actual Nextcloud/Dropbox accounts, desktop clients, native OS pickers and physical-device delivery have not been validated.** Treat the setup below as the supported app workflow with that validation boundary, rather than evidence that your client configuration transfers every file.

## Nextcloud first

1. Install and sign in to the [Nextcloud desktop client](https://docs.nextcloud.com/server/stable/user_manual/en/desktop/usage.html). Use your own server or hosting provider. Nextcloud software is open source; server infrastructure or hosted accounts may cost money.
2. Create a dedicated `HotCrossBuns` directory inside a synchronized location. Include it in the folders selected for synchronization. A shared team folder must give every editing device write access.
3. Keep the **whole directory available offline**, including its hidden `.hot-cross-buns` contents. Check ignored-file patterns and any ignore-hidden-files option. On [macOS File Provider](https://docs.nextcloud.com/server/stable/user_manual/en/desktop/macosfileprovider.html), Finder can evict local files; keep the journal directory downloaded. A placeholder is not a usable local backup.
4. Open **Commands → Settings → Nextcloud → Link Nextcloud folder** and select that dedicated directory. Existing text goes through normal import/doctor review. An empty target receives the saved browser journal.
5. Wait for the app to finish writing locally, then check the Nextcloud client's transfer status. Verify both `TODO.txt` and `.hot-cross-buns` on the second device before linking there. The verification procedure below provides a repeatable content check.
6. On the second device, finish downloading the entire directory and link it through the same action. Its initial branch may need explicit review even when the text matches. Keep the app open and visible while it catches up.

Nextcloud's [conflict documentation](https://docs.nextcloud.com/server/stable/user_manual/en/desktop/conflicts.html) describes separate files such as `TODO (conflicted copy 2026-11-15 120000).txt`. These copies may remain local rather than uploading by default. Inspect the device that created the conflict; cloud contents alone may omit that copy. Hot Cross Buns notices recognizable English conflict-copy names in the selected directory and offers **Import a conflict copy** in File sync settings. It does not modify the client or turn on conflict uploading.

## Dropbox second

1. Install and sign in to the [Dropbox desktop application](https://help.dropbox.com/sync/access-files-offline) on each editing computer.
2. Create a dedicated `HotCrossBuns` folder in Dropbox. Include it in [selective sync](https://help.dropbox.com/sync/selective-sync-overview) on **every computer**; that choice is per computer. Mark the whole folder **Make available offline**. Keep `.hot-cross-buns` included and downloaded, rather than just the visible text file.
3. Open **Commands → Settings → Dropbox → Link Dropbox folder** and select that local directory. Use the same import and initial-branch review process as Nextcloud.
4. Wait for local saving and then independently check [Dropbox's sync status](https://help.dropbox.com/sync/check-sync-status). Before switching devices, wait for transfer to finish and verify the receiving directory.
5. Keep both versions of any [Dropbox conflicted copy](https://help.dropbox.com/organize/conflicted-copy), such as `TODO (Kai's conflicted copy 2026-11-15).txt`. Use the contextual import action to review its contents. The app does not delete conflict copies after import; archive them yourself after checking the merged journal.

The app requires no paid Dropbox integration. Account storage, device allowances, organization policies and optional paid features remain Dropbox's terms; check the current plan for your devices. The browser never receives a Dropbox password or token through this workflow.

## Browser and platform boundary

Folder linking requires HTTPS or localhost, the directory picker, local file read/write permissions and Web Locks. The app checks these capabilities. Desktop Chromium is the automated browser target. Nextcloud and Dropbox client availability does not establish browser file-picker compatibility on that platform.

Safari, Firefox, mobile browsers and native OS picker behavior remain separate validation. If linking is unavailable, use **Import TODO.txt** and **Download TODO.txt**, or the existing optional [Google Drive connection](GOOGLE_DRIVE.md) where supported. Manual transfer of only TODO.txt does not carry unresolved revision branches. Offline editing refers to an already-loaded tab; this release adds no offline app-shell cache or background service. Restarting the app offline may require connectivity to load it.

Use one active target. Unlink before changing provider, account or directory. The browser is authorized to the selected directory, not a Nextcloud or Dropbox account; it cannot detect a desktop client reconfigured to back the same path with another account. Verify the destination in the client. Do not place the same live directory under two independent desktop sync engines. Existing browser journals, individual-file links and Drive links stay available; folder history still requires explicitly granting the directory. Keep custom journal filenames and their exact case unchanged because the history namespace includes the filename.

## What the app can verify

| Stage | Evidence | Boundary |
| --- | --- | --- |
| Saved in this browser | IndexedDB commit | A field still being edited is a draft; browser storage can be cleared. |
| Published to this local folder | Immutable envelope and checksum read-back | The desktop client may still be offline, paused or uploading. |
| TODO.txt up to date in this folder | Checked projection matches the saved journal | This is a local comparison, not cloud or device delivery. |
| Uploaded by the desktop client | Client/server status inspected separately | The browser has no provider upload receipt in folder mode. |
| Observed on another device | Receiving device reads matching history and projection | An additional offline device can still hold an unseen branch. |

Local editing remains available while file operations are pending. A temporary missing, unreadable or locked file retries with the shared durable backoff. After eight consecutive failures, saving pauses for **Resume file saving**. Permission denial instead asks for access; quota and other permanent disk errors need attention. The app does not create a replacement TODO.txt when a linked file temporarily disappears.

Reads and writes resolve the exact journal name inside the granted directory. A changed entry observed during staging aborts that write. This is not an atomic cross-device lock: app-authored revisions are retained before projection writes, while an arbitrary editor version overwritten before observation remains unrecoverable.

Empty or syntactically incomplete revision files wait for transfer with bounded retries. Unsupported envelopes, checksum failures, identity collisions and over-budget history stop saving. No invalid revision is integrated. A zero-byte projection does not silently clear an existing journal; the current conservative merge asks for review. Recognized provider conflict copies remain separate until you choose to import them. Unknown or localized conflict filenames can escape the heuristic; also inspect the desktop client's conflict notices.

History-first and text-first arrival can expose temporary gaps or an extra external branch. The app retains observed text and requires review where ancestry is ambiguous. It does not infer delivery order from timestamps or silently choose a winner. A wholly unseen branch excluded from transfer cannot be detected from this device alone.

## Verify two folders without exporting journal contents

With Node.js 22.18 or newer and this repository installed, finish editing, wait for local saves and desktop transfer, and pause edits on both devices. On each device run:

```console
$ npm run --silent sync:check -- /path/to/HotCrossBuns
```

For an existing custom filename, pass it as the final argument:

```console
$ npm run --silent sync:check -- /path/to/HotCrossBuns Journal.txt
```

The read-only command reuses the app's history scanner and revision graph validator. It checks the selected projection and available history, rejects observed symlink entries, and outputs a JSON receipt with:

- `projection.sha256`: exact TODO.txt bytes, without printing the text.
- `history.sha256`: sorted logical revision IDs and checksums, independent of filename ordering, timestamps and identical duplicate envelopes.
- Revision count, canonical history bytes, heads and the count of recognizable root-level conflict copies.

Compare the two SHA-256 values and heads on both devices. If they differ, retain both folders, finish transfer and inspect exclusions or unresolved branches. The tool cannot identify which device is authoritative, discover a branch neither folder contains, read browser-only pending work, or establish a cloud acknowledgement. It checks history integrity and transfer agreement, not approval of TODO.txt syntax or an import. A receipt is an observation of files read sequentially, not an atomic directory snapshot; rerun after writes stop. Root conflict-copy contents and unrelated files are not included in the two fingerprints and still need separate inspection and backup.

If saving receipts, keep them outside the live journal folder, especially outside `.hot-cross-buns`. A receipt JSON is a diagnostic observation, not a revision envelope.

No published history, missing ancestors, corrupted records, excessive scans or unreadable files return a nonzero exit status instead of a success receipt. The command never edits files or prints journal bodies or credentials. Comparing receipts also helps verify an extracted backup.

## Back up and rotate deliberately

1. Bring available devices online, finish drafts and review all observed branches. Export any unsaved browser work separately. An absent device may still hold work outside the visible history.
2. Finish desktop transfer, pause edits and run the folder check on each available device. Keep any mismatching copies for reconciliation.
3. Copy or archive the **entire dedicated folder**, including hidden history, custom filename and provider conflict copies, to a location outside the live sync directory. Keep original files while verifying the archive. Extract a copy elsewhere and compare its projection/history fingerprints.
4. At the existing 1,000-revision / 64 MiB limit, or when changing the journal filename, explicitly unlink and start a new dedicated target. Import the agreed journal there. Link that new target on the other devices. Keep the complete old archive for any offline device that returns later; its work needs review/import into the new target.

The revision graph retains its existing limits. Both the selected folder and its history directory additionally stop after 2,000 visited entries, including ignored temporary entries. Physical JSON scans remain bounded to 1,000 files and 64 MiB, including duplicates; this may pause before the logical count shown in Settings. No compaction, history deletion or automatic target rotation is introduced.

If concurrent publications already pushed the old graph over budget, its review view and folder check can refuse to load. Keep the complete original and archive; verify the backup's file list and content checksums with your backup tool instead of deleting revisions to force a receipt. Export each available browser's saved journal and any unsaved recovery draft, then review those exports into a fresh dedicated target. This does not reconcile an unavailable device or every archived intermediate branch: retain the old archive for later recovery and review those versions when they become available.

If an existing link points at a large general-purpose sync root, preserve the original and copy the journal, its entire companion history and relevant conflict copies into a dedicated subdirectory. Export current browser work before explicitly unlinking and linking that directory; review its initial branches normally. Leave unrelated files where they are. Use the default plain `TODO.txt` name for new targets; custom names must survive provider and filesystem naming rules with identical spelling, case and Unicode normalization on every device.

## Architecture decision and rollback

Both providers meet the desktop-folder use case without another connection flow or sync engine. Nextcloud is the first documented open source option; Dropbox wins the requested tie-break against OneDrive for this release. [OneDrive's folder workflow](https://support.microsoft.com/en-us/onedrive/sync-your-computer-s-files-and-folders-with-onedrive) remains a follow-up, rather than an advertised tested integration.

Direct browser adapters were evaluated separately:

- [Nextcloud WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html) supports authenticated file operations. Its documented [OAuth2 configuration](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/oauth2.html) supports confidential clients and account-wide access. A frontend must not embed that client secret. App-password authentication, HTTPS, cross-origin preflights, conditional immutable creation and complete discovery would need deployment-specific investigation before a direct WebDAV connection could ship. No assumption is made that arbitrary instances permit the app's browser origin.
- [Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth) supports public clients with PKCE and app-folder access. Its [change API](https://docs.dropboxapi.com/dropbox-api/docs/detecting-changes) uses cursors and continuation calls. A direct adapter is feasible to investigate for browser-only access, but would add an OAuth application and transport contract beyond this desktop-folder workflow.
- [Microsoft SPA authentication](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-single-page-app-sign-in) supports PKCE, and [Graph app folders](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder) offer an application-scoped directory. Those capabilities do not by themselves validate listing, creation retry or browser transport behavior for this protocol. A OneDrive adapter remains unimplemented.

Folder mode needs no app-side provider credentials, CORS permissions, pagination API or paid backend. The app's local directory iterator is still not an atomic snapshot. The shared immutable protocol, identity checks, missing-known-head checks, bounded retries, draft locks, recovery and explicit review remain responsible for app-level safety. Things 3 is an experience reference, not a claim of Things Cloud protocol or background-service equivalence.

There is no database or revision version change. `FileLink.conflictCopies` is optional local metadata; older code can ignore it. Current journals, file handles and pending identities are retained. Rollback must retain the existing version-3 opener, unsupported-revision guard and `bce3167` transport-ID reservation support. Older folder code may require manual resume for temporary errors and does not expose conflict-copy notices; preserve remote history and browser pending work when rolling back.

Transport hardening is isolated in [`fa15303`](https://github.com/gongahkia/hot-cross-buns/commit/fa15303). Reverting the provider workflow/UI/CLI commit can retain that transport support. The standalone hardening commit has its own unit/type verification; it does not require the added settings controls or verification script.

## Verification record

The automated checks are distinct from real provider validation:

| Coverage | Evidence |
| --- | --- |
| Shared last-check/write race, concurrent/offline/third branches, interrupted publication, lost replies, active drafts, undo, stale generations, integrity and retention | `tests/revisionSync.test.mjs`, existing coordinator and Drive contract tests |
| Folder resolution, stale entries, permission versus transient failures, staging replacement and copy-name discovery | `tests/linkedFile.test.mjs` |
| Interrupted creation, observed identity collision, identical copies, partial records, physical bounds and scan work | `tests/fileRevisions.test.mjs`, protocol tests |
| Isolated IndexedDB journals, offline local saving, simulated transfer, durable concurrent revisions, explicit review, convergence, History and Recovery restoration | `tests/sync-folder-providers.spec.ts` |
| Real browser file handles, temporary missing files, partial/duplicate history, excluded known ancestors, conflict-copy import, empty projections and narrow screens | `tests/sync-folder-providers.spec.ts`, existing folder/recovery browser tests |
| Read-only receipts, incomplete/corrupt history, duplicate identity, names, symlinks and privacy | `tests/syncFolderCheck.test.mjs` |

The Nextcloud/Dropbox scenario names describe fault models using their documented folder/conflict workflows, not execution of either provider's client. Network transfer in those tests is simulated; browser file handles and browser journals are real. Google authorization/HTTP remain mocked in the existing tests. Run `npm run verify` for the full suite, and `npm run sync:check` for the separate on-disk check. Native permissions, real accounts, client exclusions/hydration, cloud acknowledgements and physical devices remain unverified, as requested for this implementation. Record that validation before broadly claiming device-tested support.
