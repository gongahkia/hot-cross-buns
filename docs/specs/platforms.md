# Platform Strategy

## Release target

macOS is the only current release target. The supported runtime is the Qt bundle built by the macOS CMake presets, with Keychain credentials, system tray support, and Calendar popup reminders delivered through `UNUserNotificationCenter`.

## Deferred targets

Linux and Windows source/package scaffolding is retained for future work, but neither has feature, packaging, credential, notification, or live-account parity. Do not present either platform as supported until macOS release acceptance is complete and a dedicated parity issue closes those gaps.

## Portable boundary

The product boundary is C++ domain services plus Qt Quick models. Platform adapters own credential storage, paths, tray behavior, notifications, deep links, and packaging. Google protocol, SQLite schema, recurrence markers, and QML feature contracts must remain platform-neutral.
