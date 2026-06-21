# Cross-Platform Porting

Hot Cross Buns 2 starts on macOS, then ports to Linux, then Windows. The shared product core must remain platform-neutral before any non-Mac packaging work begins.

## Porting Order

1. macOS core app and preview packaging.
2. Linux technical preview.
3. Windows technical preview.
4. Cross-platform release hardening.

Linux comes before Windows because it exposes filesystem, desktop environment, tray, shortcut, notification, and packaging assumptions without requiring Windows signing decisions first. Windows follows once the adapter boundaries are proven outside macOS.

## Shared Core Contract

These subsystems must remain shared:

- React renderer UI except platform-specific copy and small affordances.
- TypeScript domain types.
- SQLite schema and migrations.
- Google sync service interfaces.
- MCP tool contracts and permission model.
- Preload API shapes.
- IPC validation and error shape.
- Search service contracts.
- Settings model.
- Performance fixture generation.
- Test helpers.

Platform-specific code belongs behind adapters. Renderer code should ask for capabilities and status through preload APIs rather than importing platform-specific modules or branching deeply on `process.platform`.

## Required Adapter Interfaces

Create or preserve adapter interfaces for:

- app paths and user data directories
- credential storage
- tray/status area
- app menu
- global shortcuts
- notifications
- custom protocol/deep links
- autostart/open-at-login
- update checking and installer metadata
- external URL/file opening
- diagnostics collection
- platform capability detection

Each adapter should expose a small capability report. Example capabilities:

- `supportsTray`
- `supportsGlobalShortcut`
- `supportsNotificationPermissionQuery`
- `supportsProtocolRegistrationCheck`
- `supportsAutostart`
- `supportsInPlaceAutoUpdate`
- `requiresSignedBuildForNotifications`
- `hasWaylandSession`
- `hasPortalShortcutSupport`

Current shared contract:

- Main-process native behavior is owned by `NativePlatformAdapter`.
- The adapter contract includes app paths, credential-storage status, tray/status-area creation, app-menu installation, global shortcut registration, notifications, custom protocol registration, autostart/open-at-login, update checks, external URL/file opening, diagnostics collection, and capability detection.
- Renderer code receives platform state only through `native.capabilities()` and the typed preload bridge. `NativeCapabilitiesResponse.capabilityReport` contains support flags, redacted path roles, per-capability status, and diagnostics.
- Diagnostics summary responses also include the native capability report as `native`, with redacted path strings only.
- The noop adapter is the contract test double for Linux, Windows, and unknown platforms. It reports unsupported native features and blockers; it must not be treated as platform support.

## Capability-First UI

Settings must show what the platform can actually do:

- If tray support is unavailable, show disabled status and diagnostic reason.
- If global shortcut registration fails, show the conflicting accelerator and recovery guidance.
- If notifications are unsupported or disabled, show status without failing sync.
- If auto-update is not supported for the current package, show check-for-new-version instead.
- If protocol registration is missing, show an explicit repair/check action where feasible.

## Packaging Strategy

Use electron-builder unless a future ADR replaces it.

Initial targets:

- macOS: DMG or zip preview.
- Linux: AppImage first, then DEB/RPM if user demand justifies it.
- Windows: NSIS installer first, with MSIX/Store as a later decision.

Do not expect one host machine to build all final artifacts reliably. Native modules often need target-platform builds or prebuilds, and signing is platform-specific.

## Data And Migration Compatibility

SQLite schema versioning must be identical across platforms. Platform-specific paths must not affect database contents.

Rules:

- Do not encode absolute app paths in synced or portable data.
- Store platform-specific settings under explicit namespaced keys.
- Keep migrations deterministic across OS path separators and locale settings.
- Test migrations on every platform before release.

## OAuth And Networking

Google desktop OAuth should remain the same product flow across platforms:

- loopback listener on localhost
- browser consent flow
- tokens stored in OS credential storage
- sanitized account status returned to renderer

Platform work must verify firewall prompts, browser handoff, and localhost callback behavior. MCP must continue to bind to `127.0.0.1` only.

## Performance Portability

Performance tests must be run per platform because tray/hotkey services, filesystem paths, SQLite builds, GPU acceleration, and packaging format can change startup and interaction timings.

Minimum cross-platform performance checks:

- cold launch shell visible
- warm launch shell visible
- command palette open
- quick capture open
- search latency against medium fixture
- task list scroll against large fixture
- calendar navigation against large fixture
- SQLite query-plan report

## Test Matrix

Every platform preview requires:

- typecheck/build
- unit tests
- SQLite migration/repository tests
- IPC contract tests
- MCP contract tests
- Google transport mock tests
- Playwright launch/navigation smoke
- platform manual QA checklist
- performance smoke report
- packaging smoke install/open/uninstall where relevant

## Reference Links

- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron global shortcuts: https://www.electronjs.org/docs/latest/api/global-shortcut/
- Electron notifications: https://www.electronjs.org/docs/latest/tutorial/notifications
- Electron autoUpdater: https://www.electronjs.org/docs/latest/api/auto-updater
- electron-builder targets: https://www.electron.build/docs/
- electron-builder multi-platform build: https://www.electron.build/docs/features/multi-platform-build/

## Adapter Audit

See [Platform Adapter Audit](platform-adapter-audit.md) for current Mac-only assumptions, parity classification, and Linux blockers identified before non-Mac port work.
