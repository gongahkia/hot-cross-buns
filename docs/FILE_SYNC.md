# File sync

Hot Cross Buns can save its journal directly to a linked UTF-8 `TODO.txt` file. Put that file in a [Syncthing](https://syncthing.net/) folder to carry it between devices. The app uses local file access; Syncthing runs separately. Optional [Google Drive saving](GOOGLE_DRIVE.md) is a separate alternative. Only one local or Drive file can be linked at a time; unlink the current target before switching.

## Link a file

Open **Commands → Settings → File sync**.

- **Link existing TODO.txt** opens a file and imports it through the normal doctor and merge review. Cancel a review to leave the file unlinked. Applying the import links the file and allows automatic saves, including any approved repairs.
- **Create linked TODO.txt** selects a new, empty file and saves the current journal there. It refuses to replace a file that already contains text; use **Link existing TODO.txt** to review that file instead.
- **Unlink file** stops file saving. It keeps the file and browser journal.

The file handle is remembered in this browser profile and origin. A browser restart or a permission change may require **Resume file saving** to grant access again. Direct file access requires a secure context and the file-picker and Web Locks APIs, normally available in desktop Chromium browsers. The app checks these capabilities. Other browsers retain **Import TODO.txt** and **Download TODO.txt**.

The browser still saves its working copy in IndexedDB. While a tab is open and visible, the app checks the linked file about every 1.5 seconds; persisted journal edits also schedule a check after about 750 ms. Closing the browser or leaving every tab in the background stops new checks; this is not a background service. Finish editing and wait for **Saving** to change to **up to date** before switching devices; **Last written at** shows the most recent confirmed file write. That status describes the linked file, not delivery to other devices.

Linked-file saves include the whole journal, including undated lists, details and recurrence. Undo, redo and applied manual imports also change that journal and are written to the linked file. File saves use the canonical TODO.txt format and LF line endings. Download preview options affect downloaded copies only. Scratchpad text and appearance settings stay in the browser.

## Set up Syncthing

1. Install Syncthing on the devices you use. Follow its [getting-started guide](https://docs.syncthing.net/intro/getting-started.html) to pair them and share a folder, such as `~/Sync/HotCrossBuns/`.
2. Use [Send & Receive](https://docs.syncthing.net/users/foldertypes.html#send-receive-folder) for devices on which you edit the journal. Link the folder's `TODO.txt` in Hot Cross Buns on the first device.
3. Wait for Syncthing to finish transferring that file. On the next device, choose **Link existing TODO.txt** and select its local copy of the same journal.
4. Before switching devices, finish editing, check the file-save time, and let Syncthing finish. On the next device, review any file-change notice before continuing.

Enable [file versioning](https://docs.syncthing.net/users/versioning.html) on each device if you want previous received versions retained. Syncthing versioning archives changes received from other devices; it does not archive every local browser save. Keep separate backups as needed.

A different free file-transfer tool can carry the same TODO.txt file. Hot Cross Buns has no provider-specific integration for it; its transfer, conflict and version-retention behavior must be checked separately. Syncthing is the documented free file-transfer option.

## External edits and conflicts

The app compares the browser journal and file with their last shared baseline. Independent changes merge automatically: for example, a browser title edit and a file detail edit can both survive. An active journal field or mutation review defers incoming integration across app windows until editing finishes. Completion, details and recurrence are treated together; overlapping edits, ambiguous item identity and incompatible reorders need **Review linked file**. Malformed text goes through the doctor with explicit repair approval. Known older file contents require review rather than silently undoing newer work.

The review pause is shared by app windows and survives reload. The linked file's baseline is separate from manual imports and downloads. Cancelling keeps saving paused. If the journal, file or link changes during review, cancel and reopen it; approval checks these again and commits the journal and link together. Applying a valid review resumes saving. Settings offers the browser and file copies from the latest sync comparison as separate downloads; downloading either does not change the baseline. These are limited recovery copies, not a version archive.

Browser windows on the same origin share one delivery lock. A durable frozen submission precedes each write, and a fresh read verifies its receipt. Later browser edits stay queued while file access proceeds. A tab closing or losing a receipt leaves enough state for a later tab to check the file before retrying. Syncthing and the browser cannot lock each other's writes, so a change arriving at the instant of a save can still race with it. Edit on one device at a time and keep recoverable copies. See [the shared sync protocol and limits](SYNC.md).

Syncthing may create a `*.sync-conflict-*.txt` copy when devices change the same file concurrently. It does not merge journal items; see its [conflict documentation](https://docs.syncthing.net/users/syncing.html#conflicting-changes). Keep both files, inspect their differences, and use import review to combine the intended content. Check the merged journal and exported text before replacing the shared TODO.txt or removing conflict copies.

## Paused or failed saves

Permission loss shows **Resume file saving**. Disk errors, missing files and over-budget text pause file writes with an error. After resolving the problem, choose **Resume file saving**; an external change still requires review. Unlink and link again if Syncthing replaced the file in a way that invalidated its browser handle.

Linking and file saves use the same **5 MiB / 100,000-line** limits as imports. An existing browser journal that exceeds those limits can still be downloaded in full. File saving does not replace the browser's [failed-save recovery](TODO_FORMAT.md#failed-saves).
