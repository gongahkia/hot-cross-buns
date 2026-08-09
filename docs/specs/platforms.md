# Platform Strategy

## Release targets

macOS uses the Qt bundle built by the macOS CMake presets, with Keychain
credentials, system tray support, and Calendar popup reminders delivered
through `UNUserNotificationCenter`.

Fedora 43 KDE Plasma on Wayland is the supported Linux release target. Its
signed x86_64 RPM links Fedora's Qt 6.10+ and SQLite 3.50+ packages, uses the
Secret Service bridge provided by KDE Wallet for credentials, and runs a
per-user `hcb-reminderd` service for Calendar reminders after the main window
exits. The RPM is a direct download; no DNF repository or in-place updater is
provided.

## Deferred targets

Windows remains deferred. Linux support is intentionally limited to the Fedora
43 KDE/Wayland target until a separate acceptance matrix is complete.

## Portable boundary

The product boundary is C++ domain services plus Qt Quick models. Platform adapters own credential storage, paths, tray behavior, notifications, deep links, and packaging. Google protocol, SQLite schema, recurrence markers, and QML feature contracts must remain platform-neutral.
