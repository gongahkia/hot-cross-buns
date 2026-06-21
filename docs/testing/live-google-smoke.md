# Live Google Smoke

Use this only with a disposable Google account or a clearly marked test calendar/task list.

## Preconditions

- HCB2 is connected to Google Tasks and Google Calendar.
- Sync mode is not paused.
- Diagnostics performance collection is enabled.
- Open Google Calendar and Google Tasks web in a browser for confirmation.

## Startup

- Launch HCB2.
- Confirm cached data renders before any long sync dialog blocks interaction.
- Open Diagnostics and confirm recent performance timings include `startup.bootstrap.light`.
- If bootstrap failed, confirm a `startup.bootstrap.fallback-fanout` timing explains the fallback reason.
- Confirm deferred timing appears for `startup.schedule-suggest.deferred`.

## Create

- Create one task in HCB2.
- Confirm the task appears locally immediately.
- Confirm pending mutations briefly increase.
- Confirm a recent `sync.post-crud-drain` timing appears with `accepted=true`.
- Confirm the task appears in Google Tasks web after drain.
- Create one calendar event in HCB2 and repeat the local/pending/drain/Google Calendar checks.
- Create one note in HCB2 and confirm it appears in Google Tasks web as the task-backed note model.

## Update

- Edit the test task title/date.
- Confirm local UI updates immediately.
- Confirm Google Tasks web reflects the update after drain.
- Edit the test event title/time.
- Confirm Google Calendar web reflects the update after drain.
- Edit the test note body/title and confirm Google Tasks web reflects it after drain.

## Delete

- Delete the test task.
- Confirm it disappears locally immediately.
- Confirm Google Tasks web removes it after drain.
- Delete the test event.
- Confirm Google Calendar web removes it after drain.
- Delete the test note.
- Confirm Google Tasks web removes the backing task after drain.

## Diagnostics Failure Checks

- Temporarily disconnect network.
- Create a task.
- Confirm local UI updates and pending mutation remains pending or failed.
- Confirm `sync.post-crud-drain` records `accepted=false` or pending counts remain nonzero.
- Reconnect network and run manual sync.
- Confirm the pending mutation drains and Google web reflects the change.
