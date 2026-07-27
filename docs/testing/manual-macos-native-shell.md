# Manual macOS Native Shell Checklist

Run this against a packaged macOS build after automated tests pass. Record only redacted evidence.

## Shell

- Launch the bundle, quit, and relaunch with cached data present and with network disabled.
- Verify the menu-bar item can show/hide the main window, refresh, open Settings, and quit.
- Verify there is no global quick-capture shortcut or menu claim.

## Notifications

- Grant macOS notification permission.
- Create or sync an event with a Google Calendar popup reminder.
- Verify one local notification is scheduled at the expected time, including an all-day event in a non-system timezone.
- Verify **Snooze 10 minutes** reschedules once and **Dismiss** prevents another delivery.
- Verify Calendar email reminders do not create a local notification.

## Google account

- Follow [live Google smoke](live-google-smoke.md) using a dedicated test account/client.
- Verify a timed event edit uses its selected timezone and an all-day edit keeps its calendar date.
- Verify a recurring Calendar edit appears correctly after pull, including a modified instance.
- Verify one task recurrence completion creates only one successor after sync.
- Verify search, task/event bulk operations, invitation RSVP, and a Calendar popup reminder.

Do not record tokens, client IDs, account addresses, event text, or unredacted screenshots.
