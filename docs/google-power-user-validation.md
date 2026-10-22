# Google Tasks and Calendar validation

## Local developer reset

Schema v3 is an intentional development-only reset. On first launch from an older HCB database it removes HCB's `hcb.sqlite` cache and `credentials-v1.bin`; it does not modify Google data, source files, or any other app's credentials. Re-add Google accounts from **Settings → Profile**.

## Live-account test

Use a separate Google Cloud **Desktop** OAuth client and disposable Google account. Enter the client ID (and optional client secret) in **Settings → Profile**; do not add either value to the repository.

Verify these cases manually after connecting two accounts:

1. Select different task lists/calendars for each account and confirm they remain isolated after restart.
2. Create, complete, reorder, parent, and move Tasks between lists; confirm Google Tasks reflects the changes.
3. Create, edit, delete, and split recurring Calendar events; check series, one-instance, and future-series edits.
4. Disconnect one account, make changes in the other, reconnect, and verify the disconnected account's local cache was retained.
5. Simulate offline mode, then restore connectivity; queued writes should drain. For an ETag conflict, use **Keep local version** or **Keep Google version** in Diagnostics → Sync.

## Current product boundary

The supported surface is Google Tasks, Google Calendar, local Notes/Tags, local search, task blocks, native desktop capabilities, and diagnostics. The app intentionally hides unfinished vault, MCP/agent, ICS, attachment, extension/snippet, semantic-search, and portable-archive shells from Settings and the command palette. They are retained only as dormant source for a future scoped implementation.
