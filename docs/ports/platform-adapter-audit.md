# Platform Adapter Audit

This audit prepared the shared adapter boundary before Linux and Windows port
work. It is historical; current Linux and Windows preview status lives in
[Linux Port](linux-port.md), [Windows Port](windows-port.md), and the release
docs. It does not claim Linux or Windows support.

## Mac-Only Assumptions Found

| Area | Original assumption | Current port status |
|---|---|---|
| Paths | Main startup used Electron `userData` directly for the SQLite app-support root. | Paths now have adapter-owned roles for config, data, cache, logs, diagnostics, and temp. Target-OS path QA remains part of manual validation. |
| Credentials | Google tokens used an in-memory adapter in tests/scaffolding, and MCP stored token revision state without OS-backed bearer-token persistence. | Linux now uses Secret Service/libsecret or KWallet through Electron `safeStorage` and rejects `basic_text`; Windows uses Electron `safeStorage` with encrypted metadata. Restart, locked, and failure-state checks remain manual release gates. |
| Tray/status area | The implemented adapter is macOS menu-bar oriented. | Linux tray behavior needs GNOME/KDE caveat handling. Windows notification-area semantics need separate behavior. |
| App menu | The current menu template is macOS-oriented. | Linux/Windows need adapter-owned menu templates and shortcut conventions. |
| Shortcuts | Global quick capture currently assumes Electron global shortcut registration works like macOS. | Linux Wayland/X11 and portal support must be reported as capabilities and failures, not assumed. |
| Notifications | Notification scheduling uses Electron notification support from the macOS adapter. | Linux libnotify and Windows AppUserModelID behavior need platform adapters and manual QA. |
| Custom protocol | macOS `open-url` and `setAsDefaultProtocolClient` were wired. | Linux still omits protocol metadata until desktop integration is validated; Windows installer registration is configured and still needs installed-app QA. |
| Autostart | `startOnLogin` existed as a setting but was not routed through an adapter. | The setting now calls adapter autostart methods; Linux remains unsupported for the preview, and Windows needs installed-app QA. |
| Updater | Preview builds return unsupported update status. | Linux/Windows preview should keep check-for-new-version first; no in-place auto-update is claimed. |
| Diagnostics | Diagnostics did not expose native capability detail. | Diagnostics now include a redacted native capability report. |
| OAuth | Shared OAuth loopback behavior existed conceptually, but browser handoff and token storage were not platform-proven. | Shared OAuth loopback is wired; Ubuntu GNOME and Windows browser/firewall/manual account checks remain release gates. |
| MCP | Shared MCP contracts existed, but native lifecycle and persistent bearer-token storage were not complete. | MCP runtime files, OS-backed token storage, CLI discovery, and packaged smoke automation are wired. Hosted Linux and Windows preview workflows passed MCP smoke; target desktop manual MCP checks remain release gates. |
| Packaging | `electron-builder.yml` was macOS DMG/zip only and unsigned. | Linux AppImage and Windows NSIS preview packaging are implemented and validated in manual GitHub Actions workflows; public upload remains gated by target-OS manual QA. |
| Tests | Native tests focused on service behavior, not the full adapter contract. | Contract, packaging, smoke, performance, and platform preview CI now cover the automated gates; manual QA remains required for OS shell behavior. |

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

## Remaining Linux Release Gates

- Supported Ubuntu GNOME matrix and secondary Fedora/KDE manual checks.
- Secret Service ready, missing, and locked manual checks.
- OAuth browser handoff and localhost callback verification.
- Packaged AppImage MCP localhost smoke on Ubuntu GNOME.
- Packaged AppImage terminal/file-manager launch, icon, and window grouping.
- Confirmation that tray/status-area, global shortcuts, notifications,
  protocol registration, autostart, and in-place update remain unsupported by
  design for the technical preview.
- Settings update-check validation once a draft or published release contains
  Linux AppImage assets.
