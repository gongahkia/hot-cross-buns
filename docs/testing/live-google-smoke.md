# Live Google Smoke

Use a disposable Google account or clearly marked test data. This preview reads Google Tasks and Calendar into the local SQLite mirror; it does not push local edits to Google.

## Preconditions

- Create a Google Cloud OAuth **Desktop app** client in the tester's own project.
- Enable Google Tasks API and Google Calendar API in that project.
- Add the tester as an OAuth consent-screen test user when the project is in testing mode.
- Keep the client secret out of HCB; the desktop flow uses its client ID only.
- Open Google Calendar and Google Tasks in a browser for comparison.

## Startup

- Launch HCB and open Settings.
- Enter and save the Desktop OAuth client ID.
- Select **Connect Google**, complete browser consent, and wait for `Google synchronization complete`.
- Relaunch HCB. Confirm the cached task lists, tasks, calendars, and events render, then the background read sync completes.

## Read sync

- Create or edit a task in Google Tasks. Select **Sync Google now** in HCB and confirm the task list, task title, completion state, and parent relationship match Google.
- Create or edit an event in Google Calendar. Sync and confirm calendar metadata, title, time range, all-day state, description, and location match Google.
- Delete a Google task or cancel a Google event. Sync and confirm it disappears from the active HCB views.

## Current limitation check

- Do not use HCB local task or event edits as Google write tests. They remain local and a later full Google sync can replace them.
- Reconnect after revoking the app's access in Google Account settings. Confirm the app reports that authorization must be renewed.

## Failure checks

- Disconnect the network, select **Sync Google now**, and confirm the status reports a sync failure without clearing cached data.
- Reconnect and sync again; confirm cached data refreshes.
