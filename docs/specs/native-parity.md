# Native Parity Spec

## macOS v1

- Qt application window, tray, deep links, credential storage, and local desktop reminders.
- Calendar reminders request `UNUserNotificationCenter` authorization, persist local dismiss/snooze state, and schedule active popup reminders from the local Calendar cache. Google email reminders are not converted to desktop alerts.
- Notification actions support dismiss and ten-minute snooze. Notification permission and all reminder behavior require manual live-account/macOS validation before release.

## Deferred

- Spotlight, App Intents/Shortcuts, Share extensions, and background helpers.
- Windows parity. Do not claim release support from shared C++ compilation alone.
- Full Google Calendar ACL administration; record it as a separate product issue after macOS release work.

No global quick-capture function is a required macOS feature.

## Fedora 43 KDE/Wayland v1

- The signed x86_64 RPM uses Fedora's Qt and SQLite packages, not the pinned
  macOS/portable dependencies.
- KDE Wallet supplies credentials through its Secret Service bridge; plaintext
  credential fallback is forbidden.
- The desktop entry registers `hotcrossbuns://`, and tray availability is
  detected at runtime without disabling the main application window.
- `hcb-reminderd` is a systemd user service. It owns D-Bus Calendar reminder
  delivery and notification actions after the GUI exits; dismiss and ten-minute
  snooze persist through the shared local reminder state.
- Release acceptance requires the Fedora KDE/Wayland checklist, including live
  Google OAuth, credential restart, tray fallback, URL handling, and reminder
  delivery after GUI exit.
