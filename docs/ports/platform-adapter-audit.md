# Platform Adapter Audit

This audit prepares the shared adapter boundary before Linux and Windows port work. It does not claim Linux or Windows support.

## Mac-Only Assumptions Found

| Area | Current assumption | Port impact |
|---|---|---|
| Paths | Main startup used Electron `userData` directly for the SQLite app-support root. | Paths now have adapter-owned roles for config, data, cache, logs, diagnostics, and temp. Linux still needs XDG verification. |
| Credentials | Google tokens use an in-memory adapter in tests/scaffolding, and MCP stores token revision state without OS-backed bearer-token persistence. | Linux is blocked until Secret Service/libsecret behavior is chosen and tested. Windows is blocked until Credential Manager behavior is chosen and tested. |
| Tray/status area | The implemented adapter is macOS menu-bar oriented. | Linux tray behavior needs GNOME/KDE caveat handling. Windows notification-area semantics need separate behavior. |
| App menu | The current menu template is macOS-oriented. | Linux/Windows need adapter-owned menu templates and shortcut conventions. |
| Shortcuts | Global quick capture currently assumes Electron global shortcut registration works like macOS. | Linux Wayland/X11 and portal support must be reported as capabilities and failures, not assumed. |
| Notifications | Notification scheduling uses Electron notification support from the macOS adapter. | Linux libnotify and Windows AppUserModelID behavior need platform adapters and manual QA. |
| Custom protocol | macOS `open-url` and `setAsDefaultProtocolClient` are wired. | Linux desktop-file registration and Windows installer registration remain packaging work. |
| Autostart | `startOnLogin` existed as a setting but was not routed through an adapter. | The setting now calls adapter autostart methods; Linux/Windows implementations remain unsupported. |
| Updater | Preview builds return unsupported update status. | Linux/Windows preview should keep check-for-new-version first; no in-place auto-update is claimed. |
| Diagnostics | Diagnostics did not expose native capability detail. | Diagnostics now include a redacted native capability report. |
| OAuth | Shared OAuth loopback behavior exists conceptually, but browser handoff and token storage are not platform-proven. | Linux is blocked on browser/firewall checks and OS credential storage. |
| MCP | Shared MCP contracts exist, but native lifecycle and persistent bearer-token storage are not complete. | Linux is blocked on localhost smoke tests and OS-backed token storage. |
| Packaging | `electron-builder.yml` is macOS DMG/zip only and unsigned. | Linux AppImage and Windows NSIS are deliberately out of scope for this audit. |
| Tests | Native tests focused on service behavior, not the full adapter contract. | Host-only contract tests now validate unsupported Linux/Windows reports without needing those OSes. |

## Adapter Contract

`NativePlatformAdapter` owns:

- app path role resolution
- credential-storage status
- tray/status area
- app menu
- global shortcuts
- notifications
- custom protocol/deep links
- autostart/open-at-login
- update checks
- external URL/file opening
- diagnostics collection
- platform capability detection

`NativeCapabilitiesResponse.capabilityReport` is exposed through preload. It includes support flags, redacted path roles, per-capability status, and diagnostics. `DiagnosticsSummaryResponse.native` carries the same report for copy/export flows.

The noop adapter is the portable contract fixture. It reports unsupported native behavior for Linux, Windows, and unknown platforms and records blockers instead of claiming support.

## Improvement Classification

| Source | Item | Classification |
|---|---|---|
| `01-user-facing-feature-parity` | First-run onboarding and setup | Backlog |
| `01-user-facing-feature-parity` | Advanced search, query DSL, custom filters | Shared backend/database work |
| `01-user-facing-feature-parity` | Rich calendar planning | Backlog |
| `01-user-facing-feature-parity` | Task power workflows | Backlog |
| `01-user-facing-feature-parity` | Import, export, review, forecast, help | Backlog |
| `01-user-facing-feature-parity` | Native user surfaces | Platform implementation |
| `02-backend-optimizations` | Durable Google mutation worker | Shared backend/database work |
| `02-backend-optimizations` | Real sync scheduler | Shared backend/database work |
| `02-backend-optimizations` | Debounced side effects | Shared backend/database work |
| `02-backend-optimizations` | Credential and token storage | Platform implementation |
| `02-backend-optimizations` | Runtime logging, audit, diagnostic bundles | Shared backend/database work |
| `02-backend-optimizations` | Native service lifecycle completion | Platform implementation |
| `03-database-optimizations` | SQLite bridge, pragmas, prepared statements, derived indexes, hash skips, repair paths | Shared backend/database work |
| `04-test-coverage-parity` | Search, calendar, task, persistence, backend worker, native/accessibility/product UX tests | Tests |
| `05-general-parity-and-release-polish` | GitHub Actions CI | Tests |
| `05-general-parity-and-release-polish` | Public docsite and install flow | Release docs |
| `05-general-parity-and-release-polish` | Release metadata and distribution hardening | Release docs |
| `05-general-parity-and-release-polish` | Contribution and agent workflow polish | Release docs |
| `05-general-parity-and-release-polish` | Asset and localization parity | Backlog |
| `05-general-parity-and-release-polish` | Manual QA and support readiness | Manual QA |

## Linux Blockers

- Secret Service/libsecret credential adapter and locked/missing-service diagnostics.
- Supported Ubuntu GNOME matrix and secondary Fedora/KDE manual checks.
- Tray/status-area adapter with GNOME and KDE caveats.
- Global shortcut strategy for X11 and Wayland portal sessions.
- Linux notification detection and failure reporting.
- AppImage metadata, desktop file, icon, `StartupWMClass`, and protocol registration.
- OAuth browser handoff and localhost callback verification.
- MCP localhost smoke test with OS-backed bearer-token storage.
- Package-aware update-check stance without in-place auto-update claims.
