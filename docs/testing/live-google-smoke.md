# macOS Live Google Acceptance v1

This is the macOS release acceptance procedure for Hot Cross Buns' user-owned Google Tasks and Google Calendar connection. It needs a disposable user-owned Google account and Cloud project. Do not put credentials, IDs, task/calendar titles, request logs, local databases, or screenshots containing personal data in the repository or attestation.

The redacted attestation is [macos-live-google-acceptance-v1.json](macos-live-google-acceptance-v1.json). It starts incomplete. A `v*` release workflow fails until every required check is passed and the attestation is accepted.

## Google Cloud setup

1. Create a separate Google Cloud project and OAuth **Desktop app** client. HCB accepts only the client ID; do not enter or commit a client secret.
2. Enable Google Tasks API and Google Calendar API.
3. Configure the OAuth consent screen. For an External app in Testing, add the disposable Google account as a test user. Test-mode grants expire after seven days; reconnect before testing if needed.
4. Use only the scopes HCB requests: `https://www.googleapis.com/auth/tasks` and `https://www.googleapis.com/auth/calendar`.
5. Open Google Tasks and Google Calendar in a browser. Create a dedicated empty task list and calendar. All test records must be clearly disposable.

Google's current setup and token rules: [consent screen and test users](https://support.google.com/cloud/answer/13461325), [test-mode expiry and limits](https://support.google.com/cloud/answer/15549945), [Calendar incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), and [Google Tasks methods](https://developers.google.com/workspace/tasks/reference/rest).

## Runbook

Record only the outcome in the attestation. `manual` requires the real account/browser comparison. `automated` is allowed only for quota/retry and invalid-sync-token coverage because deliberately exhausting a Google project is unsafe; run `hcb_google_http_client_tests` and `hcb_google_sync_recovery_service_tests`, then record the commit and test command without raw output.

1. Install the candidate macOS app, enter the Desktop client ID in Settings, connect Google, and wait for the first sync. Relaunch and verify cached data appears before the background sync finishes.
2. Make browser-side task and event changes, invoke **Sync Google now**, then verify HCB reflects additions, edits, deletions, task parents, event all-day/time/description/location fields, and a second sync is delta-only in effect.
3. Create, rename, select, and delete a disposable task list in HCB; after each sync, verify the browser result. Create, edit, complete, delete, reorder, reparent, and cross-list-move disposable tasks. A cross-list move is expected to recreate the remote task then delete the original, so its Google remote ID changes.
4. Enable Notes. Create an undated note in HCB; verify it is a Google Task with no due date. Verify both Notes-only and mirrored Tasks+Notes presentation modes, then edit and delete it from each side.
5. Run task and event bulk operations against at least three disposable records each. Verify every selected remote record, then search for a changed task and event locally.
6. Exercise a recurring Google Calendar event plus an exception from the browser and confirm the series and exception render after sync. Exercise managed Google Task recurrence only through the released recurrence UI. If that UI is unavailable, leave `task_recurrence` incomplete; do not hand-edit HCB's internal marker.
7. For each policy (**Prefer Google**, **Prefer HCB**, **Ask each time**), create a stale-ETag conflict: queue an offline local edit, edit the same record in Google, restore connectivity, sync, and verify the selected result remotely. For Ask each time, resolve both choices through Settings.
8. Queue one task and one event write while offline, quit HCB, relaunch while still offline, restore connectivity, and sync. Verify both remote records and that the queue does not replay them again on a second sync.
9. Revoke the app in the test account's Google Account permissions, sync, and verify the app requires reauthorization without clearing cached data. Reconnect and verify a later sync succeeds.
10. Force a transient network failure while syncing, then restore connectivity. Verify cache retention, retry/recovery, and no duplicate mutation. Run the native quota/retry and invalid-sync-token tests listed in the attestation; Calendar `410 Gone` must clear the stored token and full-resync.

## Attestation rules

- Change `attestation_status` to `accepted` only when every check is `passed`.
- Keep `redacted` true. Evidence may contain candidate commit, package version, macOS version, architecture, UTC execution time, and test command names only.
- A failure, unavailable recurrence editor, missing OAuth setup, or missing manual browser comparison remains `incomplete`; it blocks release promotion by design.
- Never include the Desktop client ID, account email, task/calendar IDs or titles, tokens, cookies, SQLite paths, raw API payloads, screenshots, or logs.
