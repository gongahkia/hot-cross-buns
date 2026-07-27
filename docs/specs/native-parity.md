# Native Parity Spec

## macOS v1

- Qt application window, tray, deep links, credential storage, and local desktop reminders.
- Calendar reminders request `UNUserNotificationCenter` authorization, persist local dismiss/snooze state, and schedule active popup reminders from the local Calendar cache. Google email reminders are not converted to desktop alerts.
- Notification actions support dismiss and ten-minute snooze. Notification permission and all reminder behavior require manual live-account/macOS validation before release.

## Deferred

- Spotlight, App Intents/Shortcuts, Share extensions, and background helpers.
- Linux and Windows parity. Do not claim release support from shared C++ compilation alone.
- Full Google Calendar ACL administration; record it as a separate product issue after macOS release work.

No global quick-capture function is a required macOS feature.
