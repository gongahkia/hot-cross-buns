# Cross-platform porting

Hot Cross Buns shares its C++20 domain services, SQLite schema, Google clients,
and QML UI across platforms. Platform adapters own credentials, paths,
notifications, tray behavior, deep links, and package integration.

## Supported targets

- macOS: Qt bundle with Keychain and `UNUserNotificationCenter` reminders.
- Fedora 43 x86_64, KDE Plasma on Wayland: RPM with system Qt 6.10+ and SQLite
  3.50+, Secret Service credentials, KDE tray support where available, and a
  systemd user reminder service.

Windows is deferred. Other Linux distributions and desktop environments are
not supported targets until they have their own acceptance matrix.

## Shared invariants

- SQLite migrations and synced data are platform-neutral; no absolute paths
  enter portable or remote data.
- Credentials stay in the operating system's credential service and never in
  SQLite or diagnostic output.
- OAuth always uses the user-owned Desktop client, browser handoff, PKCE, and a
  loopback callback.
- Native failures must report a specific unavailable state without interrupting
  local data, sync, or the main window.

## Port acceptance

Each supported target requires a clean build, unit/QML tests, package install
smoke, live OAuth and Google-account smoke, credential restart verification,
desktop-integration checks, reminder delivery, and a performance smoke report.
