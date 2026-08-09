# Platform adapter audit

| Capability | macOS | Fedora 43 KDE/Wayland |
| --- | --- | --- |
| App paths | `QStandardPaths` macOS adapter | `QStandardPaths` Linux adapter |
| Credentials | Keychain | Secret Service through KDE Wallet's bridge |
| Browser OAuth | `QDesktopServices` | `QDesktopServices` |
| Tray | `QSystemTrayIcon` | `QSystemTrayIcon`, capability checked at runtime |
| Calendar reminders | `UNUserNotificationCenter` | freedesktop D-Bus notifications via `hcb-reminderd` |
| Reminder lifetime | survives GUI exit | systemd user daemon survives GUI exit in the desktop session |
| Deep links | launch URL handling | `x-scheme-handler/hotcrossbuns` desktop registration |
| Package | universal macOS package | signed direct-download x86_64 RPM |

The Fedora credential path must be tested with the wallet available, locked,
and absent. The tray is optional at runtime because KDE session configuration
can disable StatusNotifier items; the main window remains usable. The reminder
daemon requires the session D-Bus notification service and reports a concrete
status when that service is unavailable.
