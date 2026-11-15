# Google Drive

Google Drive is an optional alternative to a local [Syncthing-linked file](FILE_SYNC.md). Hot Cross Buns saves a normal UTF-8 `TODO.txt` in your Google account. The journal also keeps its working copy in IndexedDB. No Google account is required to use the journal, import files or download copies.

Only one sync target can be linked in a browser profile and origin: either a local file or a Google Drive file. Unlink the current target before switching. Both the file and browser journal remain available after unlinking.

## Configure Google

This follows the older browser app's Google Identity Services token-popup approach. A **Web OAuth client ID** authorizes private account access; an API key alone cannot do that. You supply your own Google Cloud project. The app requests `openid`, `email` and [`drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth): files created by, or explicitly opened through, this app. It does not request access to all of your Drive.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/). Enable the **Google Drive API**.
2. Configure the OAuth consent screen. For an external app in testing, add the Google accounts you intend to use as test users. Google controls consent, testing access, token expiry and any publishing requirements.
3. Create an OAuth client with application type **Web application**. Add each exact **Authorized JavaScript origin** you will use, such as `https://hot-cross-buns.vercel.app` or `http://127.0.0.1:5173` (the local dev server). Include the port; do not include a path. A preview deployment has a different origin and needs its own entry.
4. Open **Commands → Settings → Google Drive → Google connection setup**. Enter the Web OAuth client ID and choose **Save Google configuration**.
5. Choose **Connect Google Drive**, select the intended account and approve file access. Allow Google's sign-in popup if your browser blocks it.

A Web OAuth client ID is sufficient to **Create TODO.txt in Google Drive** and list up to 20 recent editable, size-compatible text files already authorized for this app. To browse other existing text files with **Choose from Google Drive**, also:

1. Enable the **Google Picker API** in the same project.
2. Create a browser API key. Restrict it to the Google Picker API and your app's exact website referrers. Follow Google's [Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample) for the applicable restrictions.
3. Enter that **Picker API key** and the project's numeric **Cloud project number** in connection setup. The project number is distinct from its project ID and the OAuth client ID. Save the configuration and connect again.

The public client ID, browser key and project number are saved in this browser's localStorage. A self-hosted build can instead supply `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_PROJECT_NUMBER`; see [`.env.example`](../.env.example). Vite exposes these values in the delivered JavaScript. Do not put a client secret, service-account key, refresh token or other private credential in a `VITE_*` variable.

The integration needs a secure context and Web Locks, in addition to Google's browser services. Use a modern browser over HTTPS or localhost. Content blockers, unavailable Google services, incorrect origins or project settings can stop connection; the local journal remains usable.

## Link a journal

- **Create TODO.txt in Google Drive** creates a new file containing the complete saved journal. It does not replace an existing file with the same name. It links that new file for later saves.
- **Choose from Google Drive** opens Google's file picker for plain text. Alternatively, choose a file from **Recent text files opened by this app**. Its contents pass through the normal TODO.txt doctor and merge review before linking. Cancelling a review leaves it unlinked; approved repairs are saved only after applying the import.
- **Check Google Drive now** checks the linked file without waiting for the next automatic check.
- **Unlink Google Drive file** stops saving to it across this origin's app windows, keeping both copies.
- **Sign out of this tab** discards this tab's in-memory session. It does not revoke Google's consent, delete the file, unlink other windows or sign you out of Google elsewhere. Manage granted access in your Google account if you want to revoke it.

The file link remembers the Google account's stable identifier. Reconnecting must use that account; unlink the file before changing accounts. Hot Cross Buns keeps access tokens in tab memory and does not save them in IndexedDB, localStorage or sessionStorage. Its API requests send tokens in authorization headers. Reloading a tab or nearing token expiry requires **Connect Google Drive** again. There is no stored refresh token or server-side Google session. Google's [token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) requires user interaction to authorize another session.

## Saving and external changes

While a tab is open and visible, persisted journal edits trigger a save check after about 750 ms. The linked file is also checked about every 15 seconds and when returning to the tab or connection. Saving pauses during an import review or a failed browser save. The journal's status distinguishes browser storage from file saving, offline catch-up and reconnecting. Finish editing, wait for **up to date** and check **Last written at** before switching devices. This describes the Drive file, not another device's receipt. Closing all tabs or leaving them in the background stops new checks; this is not a background service.

Google Drive saves include the entire journal, including undated lists, details and recurrence, in canonical TODO.txt with LF line endings. Scratchpad text and appearance preferences stay in the browser. The same **5 MiB / 100,000-line** limits apply as for imports. Google Docs documents and folders cannot be linked as TODO.txt files.

The shared [sync layer](SYNC.md) merges independent browser and file edits against their last common baseline. For example, a title edit can merge with a detail edit. Overlapping changes, ambiguous item matches, incompatible reorders and known older file contents show **Review Google Drive file**. Completion, details and recurrence form one change group. Incoming integration waits for active journal editing or mutation reviews to finish across app windows. The pause survives reload. Review uses this file's own baseline; cancel and reopen if the journal, file or link changes before approval. Valid approval commits the journal and link together. Settings keeps one downloadable browser/file comparison pair for recovery while linked.

Same-origin browser windows serialize delivery with a shared lock. Network requests release local editing and link-control locks. Remote text is read between matching Drive version checks, then checked against the saved baseline before an upload. A strong ETag, when returned by Google, is sent as `If-Match`; a `412` response triggers another read and merge, with at most three race attempts before review. **The final check and upload are not a guaranteed atomic compare-and-swap.** Another device can change the file during that interval. Edit on one device at a time and retain backups or Drive revisions.

Each save has a durable frozen checkpoint before dispatch and a read-back before acknowledgement. A lost response or reload first checks whether that text reached Drive; a matching file retires the checkpoint without another upload. Newer edits and undo remain queued. Offline edits catch up automatically when an authorized visible tab returns online. Temporary network errors, timeouts, rate limits and selected server errors use a durable, jittered retry delay (about 2 seconds initially, up to 72 seconds). After eight consecutive failures, saving requires **Resume Google Drive saving**. Denied access and other permanent failures also require attention. The browser journal remains available, including normal [failed-save recovery](TODO_FORMAT.md#failed-saves).

An expired or rejected token requires reconnecting **in that tab**. Another visible window with a valid session can continue delivery; a reconnect notice in one tab does not sign out other windows. Sessions remain private to each tab.

File creation uses a separate durable ticket containing the exact submitted journal. An unconfirmed response blocks another automatic creation, including after reload. Reconnect to the same account and choose the existing file to review and link it. **Download submitted journal** preserves the creation snapshot. After inspecting Drive, **Allow another creation** explicitly retires that ticket; it may create a duplicate if the earlier request succeeded. The app never automatically repeats an uncertain creation.

## Verification boundary

Automated tests substitute Google sign-in, Picker and Drive responses. They cover scopes, account checks, token persistence boundaries, creation, merging, conflict review, interrupted requests, checkpoint and receipt failures, offline retries, undo, reload and cross-tab handoff. They do not establish that a particular Google Cloud project's consent screen, key restrictions or origins are configured correctly. Check sign-in, file creation, remote edits, reconnecting and revocation with your own project before relying on Drive saving.
