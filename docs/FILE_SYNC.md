# File sync

Hot Cross Buns can save its journal directly to a linked UTF-8 `TODO.txt` file. Put that file in a [Syncthing](https://syncthing.net/) folder to carry it between devices. The app uses local file access; Syncthing runs separately. Optional [Google Drive saving](GOOGLE_DRIVE.md) is a separate alternative. Only one local or Drive file can be linked at a time; unlink the current target before switching.

## Link a file

Open **Commands → Settings → File sync**.

- **Link existing TODO.txt** opens a file and imports it through the normal doctor and merge review. Cancel a review to leave the file unlinked. Applying the import links the file and allows automatic saves, including any approved repairs.
- **Create linked TODO.txt** selects a new, empty file and saves the current journal there. It refuses to replace a file that already contains text; use **Link existing TODO.txt** to review that file instead.
- **Unlink file** stops file saving. It keeps the file and browser journal.

The file handle is remembered in this browser profile and origin. A browser restart or a permission change may require **Resume file saving** to grant access again. Direct file access requires a secure context and the file-picker and Web Locks APIs, normally available in desktop Chromium browsers. The app checks these capabilities. Other browsers retain **Import TODO.txt** and **Download TODO.txt**.

The browser still saves its working copy in IndexedDB. While a tab is open and visible, the app checks the linked file about every 1.5 seconds and writes persisted journal edits. Closing the browser or leaving every tab in the background stops those checks; this is not a background service. Wait for **Saving** to change to **up to date** in Settings before switching devices; **Last written at** shows the most recent file write.

Linked-file saves include the whole journal, including undated lists, details and recurrence. Undo, redo and applied manual imports also change that journal and are written to the linked file. File saves use the canonical TODO.txt format and LF line endings. Download preview options affect downloaded copies only. Scratchpad text and appearance settings stay in the browser.

## Set up Syncthing

1. Install Syncthing on the devices you use. Follow its [getting-started guide](https://docs.syncthing.net/intro/getting-started.html) to pair them and share a folder, such as `~/Sync/HotCrossBuns/`.
2. Use [Send & Receive](https://docs.syncthing.net/users/foldertypes.html#send-receive-folder) for devices on which you edit the journal. Link the folder's `TODO.txt` in Hot Cross Buns on the first device.
3. Wait for Syncthing to finish transferring that file. On the next device, choose **Link existing TODO.txt** and select its local copy of the same journal.
4. Before switching devices, finish editing, check the file-save time, and let Syncthing finish. On the next device, review any file-change notice before continuing.

Enable [file versioning](https://docs.syncthing.net/users/versioning.html) on each device if you want previous received versions retained. Syncthing versioning archives changes received from other devices; it does not archive every local browser save. Keep separate backups as needed.

A different free file-transfer tool can carry the same TODO.txt file. Hot Cross Buns has no provider-specific integration for it; its transfer, conflict and version-retention behavior must be checked separately. Syncthing is the documented free file-transfer option.

## External edits and conflicts

When the linked file differs from its last reviewed or saved contents, the app pauses file saves and shows **Review linked file**. That pause is shared by app windows and survives a reload. Reviewing uses the file's own baseline, separately from manual imports and downloads. The normal doctor and merge review apply; overlapping changes need a decision. Cancelling keeps file saving paused. If another app window changes the journal during a conflict review, cancel and reopen that review before applying it. Applying the review resumes saving the merged journal.

Browser windows on the same origin share a write lock. Before committing a staged write, the app checks the file again for external changes. Syncthing and the browser cannot lock each other's writes, so a change arriving at the instant of a save can still race with it. Edit on one device at a time and keep recoverable copies.

Syncthing may create a `*.sync-conflict-*.txt` copy when devices change the same file concurrently. It does not merge journal items; see its [conflict documentation](https://docs.syncthing.net/users/syncing.html#conflicting-changes). Keep both files, inspect their differences, and use import review to combine the intended content. Check the merged journal and exported text before replacing the shared TODO.txt or removing conflict copies.

## Paused or failed saves

Permission loss shows **Resume file saving**. Disk errors, missing files and over-budget text pause file writes with an error. After resolving the problem, choose **Resume file saving**; an external change still requires review. Unlink and link again if Syncthing replaced the file in a way that invalidated its browser handle.

Linking and file saves use the same **5 MiB / 100,000-line** limits as imports. An existing browser journal that exceeds those limits can still be downloaded in full. File saving does not replace the browser's [failed-save recovery](TODO_FORMAT.md#failed-saves).
