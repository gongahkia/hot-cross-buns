# File sync

Hot Cross Buns can save its journal to a UTF-8 `Planner.md` file in a [Syncthing](https://syncthing.net/), [Nextcloud or Dropbox desktop folder](SYNC_FOLDERS.md). **Link sync folder** enables [immutable revision history](REVISION_SYNC.md): the app keeps companion snapshots before updating the text file. The app uses local file access; the desktop client runs separately. Nextcloud/Dropbox setup, offline availability, ignored files, validation boundaries and the read-only `sync:check` command are covered in [the folder guide](SYNC_FOLDERS.md). Optional [Google Drive saving](GOOGLE_DRIVE.md) is an alternative. Only one local or Drive target can be linked at a time; unlink it before switching.

## Link a file

Open **Commands → Settings → File sync**.

- **Link sync folder** grants access to a folder containing `Planner.md` and its `.hot-cross-buns` history directory. An existing journal passes through doctor/import review; an empty journal receives the saved browser contents. Sync the entire folder on every device.
- **Enable folder revision history** upgrades an existing individual-file link. Select its actual containing folder; choosing another folder leaves the existing link unchanged. Existing custom filenames are retained.
- **Link existing Planner.md** opens a file and imports it through the normal doctor and merge review. Cancel a review to leave the file unlinked. Applying the import links the file and allows automatic saves, including any approved repairs.
- **Create linked Planner.md** selects a new, empty file and saves the current journal there. It refuses to replace a file that already contains text; use **Link existing Planner.md** to review that file instead.
- **Unlink file** stops file saving. It keeps the file and browser journal.

The file handle is remembered in this browser profile and origin. A browser restart or a permission change may require **Resume file saving** to grant access again. Direct file access requires a secure context and the file-picker and Web Locks APIs, normally available in desktop Chromium browsers. The app checks these capabilities. Other browsers retain **Import Planner.md** and **Download Planner.md**.

The individual-file options use individual-file mode, with no shared revision history and a remaining overwrite window. Settings labels this explicitly. Folder history requires the directory-picker API. Folder permission is remembered alongside the file handle; it is not permission to other folders.

The browser still saves its working copy in IndexedDB. While a tab is open and visible, the app checks the linked file about every 1.5 seconds; persisted journal edits also schedule a check after about 750 ms. Closing the browser or leaving every tab in the background stops new checks; this is not a background service. Finish editing and wait for **Saving** to change to **up to date** before switching devices; **Last written at** shows the most recent confirmed file write. That status describes the linked file, not delivery to other devices.

Linked-file saves include the whole journal, including undated lists, details, recurrence, ordinary Markdown bodies and the shared scratchpad. Undo, redo and applied manual imports also change that journal and are written to the linked file. File saves use the source-preserved Markdown format and retain existing line endings. Download preview options affect downloaded copies only. Scratchpad text is included in the shared Markdown document. Appearance settings stay in the browser.

## Set up Syncthing

1. Install Syncthing on the devices you use. Follow its [getting-started guide](https://docs.syncthing.net/intro/getting-started.html) to pair them and share a folder, such as `~/Sync/HotCrossBuns/`.
2. Use [Send & Receive](https://docs.syncthing.net/users/foldertypes.html#send-receive-folder) for devices on which you edit the journal. Choose **Link sync folder** in Hot Cross Buns on the first device. Include `.hot-cross-buns` in the synced folder; do not ignore it.
3. Wait for Syncthing to transfer the text and history. On the next device, choose **Link sync folder** and select its local copy. Review any branch notice from linking that browser's own journal with the existing history.
4. Before switching devices, finish editing, check the file-save time, and let Syncthing finish. On the next device, review any file-change notice before continuing.

Enable [file versioning](https://docs.syncthing.net/users/versioning.html) on each device if you want previous received versions retained. Syncthing versioning archives changes received from other devices; it does not archive every local browser save. Keep separate backups as needed.

A different file-transfer tool can carry the same dedicated folder. Its transfer, conflict and version-retention behavior must be checked separately. Nextcloud and Dropbox use this same folder transport, with setup guidance and simulated transfer fault tests; they are not direct API integrations or device-validated providers. Include both the text and complete history, rather than syncing only Planner.md.

## External edits and conflicts

Protected folder links retain app-authored revisions independently of the latest `Planner.md`. Valid linear changes can apply automatically; concurrent branches require **Review linked file**. Observed external editor contents are captured before replacement. An external edit overwritten before the app observes it remains outside this protection. Missing or corrupted history pauses saving. Settings shows the observed revision count and size; at **1,000 revisions / 64 MiB**, export and archive all history before starting a new target. Nothing is pruned automatically. See [protocol and retention](REVISION_SYNC.md).

Single-file mode compares the browser journal and file with their last shared baseline. Independent changes can merge automatically; overlapping changes and ambiguous identity require review. Both modes defer incoming integration during active journal editing or mutation reviews, retain recurrence validation, and require explicit doctor repair approval.

The review pause is shared by app windows and survives reload. The linked file's baseline is separate from manual imports and downloads. Cancelling keeps saving paused. If the journal, file or link changes during review, cancel and reopen it; approval checks these again and commits the journal and link together. Applying a valid review resumes saving. Settings offers the browser and file copies from the latest sync comparison as separate downloads; downloading either does not change the baseline. These are limited recovery copies, not a version archive.

Browser windows on the same origin share one delivery lock. A durable frozen submission precedes each write, and a fresh read verifies its receipt. Later browser edits stay queued while file access proceeds. A tab closing or losing a receipt leaves enough state for a later tab to check the file before retrying. Syncthing and the browser cannot lock each other's writes, so a change arriving at the instant of a save can still race with it. Edit on one device at a time and keep recoverable copies. See [the shared sync protocol and limits](SYNC.md).

Syncthing may create a `*.sync-conflict-*.txt` copy when devices change the same file concurrently. It does not merge journal items; see its [conflict documentation](https://docs.syncthing.net/users/syncing.html#conflicting-changes). Keep both files, inspect their differences, and use import review to combine the intended content. Check the merged journal and exported text before replacing the shared Planner.md or removing conflict copies.

## Paused or failed saves

Permission loss shows **Resume file saving**. Temporary missing, unreadable or locked files retry with bounded durable backoff; after eight consecutive failures they pause for manual resume. Quota and other permanent disk errors pause immediately. Over-budget text also stops writes. After resolving the problem, choose **Resume file saving** if needed; an external change still requires review. Folder links resolve the exact filename inside the granted directory and retain a newly confirmed handle. The app does not recreate a missing linked projection. If the selected directory moved or access remains invalid, explicitly relink the actual directory while preserving its complete history.

Recognizable Nextcloud, Dropbox and Syncthing conflict-copy names produce a contextual sync notice and **Import a conflict copy** in Settings. Import uses the existing doctor and conflict review; no copy is merged or deleted automatically. The notice describes files still present, including copies you may already have reviewed. Archive them outside the live folder after checking the merged journal. The name heuristic does not identify every localized or arbitrary filename; inspect the client too. Both root and history enumeration stop after 2,000 visited entries, including ignored temporary entries.

Linking and file saves use the same **5 MiB / 100,000-line** limits as imports. An existing browser journal that exceeds those limits can still be downloaded in full. File saving does not replace the browser's [failed-save recovery](MARKDOWN_RUNTIME.md#conflicts-and-recovery).
