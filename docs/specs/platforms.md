# Platform Strategy

## Scope

Hot Cross Buns 2 starts as a macOS app and must be designed for Windows and Linux expansion. Platform behavior belongs behind adapters so core product logic is shared.

## Platform Priority

1. macOS core app
2. Linux technical preview
3. Windows technical preview

The first implementation should not add Windows/Linux packaging until the macOS core app is useful, but it must avoid Mac-only assumptions in core services.

## Shared Core

Shared across all platforms:

- renderer UI
- domain types
- SQLite repositories
- Google sync
- MCP tools
- preload API shapes
- IPC validation
- command palette command model
- settings model
- test helpers

## Platform Adapters

Create adapter interfaces for:

- app paths
- Keychain/credential storage
- tray/menu bar
- app menu
- global shortcuts
- notifications
- deep links/custom protocol
- autostart/open-at-login
- updater/check-for-update UX
- installer metadata
- diagnostics collection
- platform capability detection

The renderer should not branch directly on platform except for display text and minor interaction conventions.
Native capability state is exposed through the typed preload bridge as `native.capabilities()`. The response includes a `capabilityReport` with redacted path roles, support flags, per-capability status, and diagnostics. Diagnostics summaries include the same native report for copy/export flows.

## macOS V1

Required:

- main app window
- menu bar/tray icon
- app menu with standard edit shortcuts
- global quick capture shortcut
- local notifications
- custom protocol links
- Keychain token storage
- Application Support path for app data
- preview DMG or zip distribution

Deferred:

- Spotlight indexing
- App Intents/App Shortcuts
- Share Extension
- signed/notarized release flow

## Linux Future

Required before Linux preview:

- credential storage decision, likely Secret Service/libsecret where available
- tray behavior with desktop-environment caveats
- global shortcut strategy with Wayland/X11 constraints documented
- AppImage package target first
- desktop file metadata and icon/window association
- custom protocol registration approach
- notification support caveats through libnotify-compatible desktops
- updater strategy that respects package managers where relevant
- supported distro/desktop matrix

Linux support should start with a documented supported-distro matrix rather than claiming universal parity.

See [Linux Port](../ports/linux-port.md).

## Windows Future

Required before Windows preview:

- Windows credential storage adapter
- tray behavior for notification area
- global shortcut registration and conflict handling
- Windows installer target
- app user model id
- custom protocol registration
- Windows notification behavior
- code signing/SmartScreen plan

Windows must use the same SQLite schema and Google sync services.

See [Windows Port](../ports/windows-port.md).

## Shared Porting Reference

See [Cross-Platform Porting](../ports/cross-platform-porting.md) for adapter contracts, capability-first UI behavior, and cross-platform test gates.

## Testing Matrix

Before broad release:

- macOS: full test and smoke suite
- Linux: unit, IPC, SQLite, Google mock, launch smoke, tray/hotkey caveat pass
- Windows: unit, IPC, SQLite, Google mock, launch smoke, tray/hotkey manual pass
