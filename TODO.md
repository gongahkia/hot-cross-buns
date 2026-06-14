# TODO: Linux Port Technical Preview

This document is the implementation handoff for porting Hot Cross Buns 2 from
macOS-only preview support to a Linux technical preview without deprecating,
weakening, or renaming the existing macOS support.

The first committed pass is documentation-only. Do not add runtime Linux support
claims until the implementation phases and release gates below are complete.

## Current Decisions

- First Linux target: Ubuntu LTS on GNOME.
- First package target: AppImage technical preview.
- Secondary manual checks: Fedora Workstation GNOME, KDE Plasma, one Wayland
  session, and one X11 session.
- Linux credential backend: Electron `safeStorage` through a maintained
  `SecretStore` abstraction, enabled only for OS-backed providers such as
  `gnome_libsecret`, `kwallet`, `kwallet5`, or `kwallet6`. Electron
  `basic_text` plaintext fallback is rejected. `keytar` was rejected as
  unsuitable because its upstream repository is archived and its prebuilt
  Electron support is stale for this repo's Electron 33 runtime.
- Linux update policy: check for GitHub Releases only. Do not claim in-place
  Linux auto-update for the technical preview.
- Tray, global shortcuts, notifications, deep links, and autostart must be
  capability-driven. Unsupported or unverified Linux behavior must remain
  recoverable and visible in diagnostics.

## Current Repo State

- The app is an Electron, Vite, React, TypeScript, and SQLite desktop app.
- `electron-builder.yml` defines macOS DMG/zip packaging and a Linux AppImage
  technical preview target. Linux protocol metadata remains omitted until the
  deep-link release gate is validated.
- `package.json` keeps the existing macOS release scripts and also defines
  Linux preview scripts:
  - `build:release:mac`
  - `build:release:linux`
  - `pack:mac:preview`
  - `pack:linux:preview`
  - `release:mac:preview`
  - `release:linux:preview`
  - `release:linux-artifacts`
  - `release:smoke-dmg`
  - `release:smoke-appimage`
- `src/main/index.ts` selects native behavior through `createNativeAdapter()`.
  Linux startup uses `electron-linux-preview` and does not instantiate
  mac-specific native code.
- `NativePlatformAdapter` in `src/main/native/types.ts` is the correct boundary
  for Linux-specific native behavior.
- Linux local notification scheduling is explicitly unsupported in the technical
  preview until GNOME/KDE packaged delivery and click-through behavior are
  manually validated. The lower-level Electron implementation remains guarded
  behind `HCB_LINUX_ENABLE_UNVALIDATED_NATIVE_SHELL=1` for future validation
  runs.
- Linux global shortcut registration is explicitly unsupported in the technical
  preview until X11, Wayland portal, denial, conflict, and packaged AppImage
  dispatch behavior are manually validated. The lower-level Electron
  implementation remains guarded behind
  `HCB_LINUX_ENABLE_UNVALIDATED_NATIVE_SHELL=1` for future validation runs.
- Linux tray/status-area support is explicitly unsupported in the technical
  preview until GNOME and KDE status-icon behavior is manually validated. The
  main window remains the supported Linux control surface.
- Linux `hotcrossbuns://` registration is explicitly unsupported until installed
  AppImage desktop integration is validated. Linux AppImage metadata
  intentionally omits the scheme.
- Linux open-at-login/autostart is explicitly unsupported in the technical
  preview. The adapter does not create or remove user-level autostart
  `.desktop` entries.
- Linux update checks use the shared GitHub Releases check-for-new-version flow
  and prefer AppImage assets. No Linux update is downloaded or installed
  automatically.
- Google OAuth and MCP both use loopback-only network surfaces. OAuth opens the
  system browser through the native external URL adapter and listens on
  `127.0.0.1`; MCP binds to `127.0.0.1`, writes only non-secret discovery
  metadata under the app config path, and stores bearer tokens through the
  OS-backed `SecretStore`.
- `createNoopNativeAdapter()` already reports unsupported Linux behavior without
  claiming support and should remain the unsupported-platform contract fixture.
- `MacOsKeychainSecretStore` and `LinuxSecretServiceStore` are the OS-backed
  `SecretStore` implementations. Other platforms fall back to
  `UnsupportedSecretStore`.
- Google OAuth tokens, the optional OAuth client secret, and the MCP bearer token
  already flow through `SecretStore` abstractions, so Linux credential work
  should extend that abstraction rather than inventing a new credential path.
- Existing porting docs already live under `docs/ports/`, especially:
  - `docs/ports/linux-port.md`
  - `docs/ports/platform-adapter-audit.md`
  - `docs/ports/cross-platform-porting.md`

## Non-Negotiables

- Do not remove, rename, or degrade the macOS adapter, macOS Keychain storage,
  DMG/zip packaging, macOS release scripts, or macOS support docs.
- Do not store Google OAuth tokens, OAuth client secrets, MCP bearer tokens, or
  future sensitive material in plaintext as a Linux fallback.
- Do not expose raw tokens, raw Google payloads, absolute local paths, or bearer
  tokens in renderer state, diagnostics, logs, release artifacts, or support
  bundles.
- Do not branch deeply in renderer code on `process.platform`. Renderer behavior
  should use typed preload capability data from the native adapter.
- Do not claim Linux tray, global shortcut, notification, protocol, autostart,
  or updater parity until each feature has automated tests where feasible and
  manual QA on the supported Linux matrix.
- Do not assume GNOME tray/status-icon behavior matches macOS menu bar behavior.
  The app must remain fully usable without a tray icon.

## Phase 1: Non-Claiming Linux Scaffold

Goal: make Linux startup select a Linux-aware adapter that reports honest
capabilities without trying to implement fragile desktop-environment behavior
too early.

Status: Complete as of 2026-06-13 in implementation commit `905210c`. The app
now selects native adapters through an async platform factory, lazy-loads the
macOS adapter only for `darwin`, uses a non-claiming
`electron-linux-preview` adapter for `linux`, and leaves Windows and unknown
platforms on the existing noop adapter. Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts`
- `pnpm test`
- `pnpm build`

Implementation tasks:

- Add a native adapter factory, for example
  `src/main/native/createNativeAdapter.ts`, with this selection:
  - `darwin`: existing `createElectronMacNativeAdapter()`
  - `linux`: new Linux preview adapter
  - `win32` and unknown platforms: existing `createNoopNativeAdapter()`
- Update `src/main/index.ts` to use the factory instead of importing the macOS
  adapter directly.
- Add a Linux adapter module, for example
  `src/main/native/electronLinuxAdapter.ts`, plus small helper files under
  `src/main/native/electronLinux/` only as needed.
- Initial Linux adapter behavior:
  - `appPaths()`: map config, data, cache, logs, diagnostics, and temp through
    Electron/app path APIs and verify they respect XDG expectations on Ubuntu.
  - `capabilities()`: report Linux platform, adapter id, package format, path
    roles, and per-feature states.
  - `credentialStorageStatus()`: report `pending` until Phase 2 is implemented.
  - `openExternalUrl()`: use Electron `shell.openExternal()` and return a
    sanitized success/error result.
  - `openPath()`: use Electron `shell.openPath()` and return a sanitized
    success/error result.
  - `collectDiagnostics()`: return an adapter diagnostic result without raw
    paths beyond existing redacted path capabilities.
  - `installAppMenu()`: install a conventional Linux app menu only if simple and
    low-risk; otherwise return unsupported for the first scaffold.
  - `createTray()`, `registerGlobalShortcut()`, `registerProtocolClient()`,
    `scheduleNotification()`, and `setAutostart()`: return unsupported or
    pending until their dedicated phases are complete.
  - `listFontFamilies()`: return an empty normalized list for the scaffold unless
    a low-risk fontconfig query is added with tests.
- Preserve the noop adapter behavior and tests. The Linux adapter is not a
  replacement for noop.

Automated tests:

- Add adapter factory tests for `darwin`, `linux`, `win32`, and unknown platform
  selection. If direct `process.platform` mocking is awkward, extract the
  selection logic into a pure function that accepts a platform argument.
- Add Linux adapter contract tests that validate:
  - `nativeCapabilitiesResponseSchema` accepts the Linux capability response.
  - mac-specific adapter ids are not reported on Linux.
  - unsupported features are recoverable and carry diagnostic messages.
  - `openExternalUrl()` and `openPath()` sanitize failure messages.
- Keep existing macOS native tests passing unchanged.

Acceptance criteria:

- A Linux dev run no longer instantiates `electronMac` adapter code.
- Linux capability reports are schema-valid.
- At Phase 1 completion, Linux still did not claim tray, shortcut,
  notification, protocol, autostart, credential, or updater parity. Phase 2 now
  adds conditional credential support without changing the other unsupported
  native features.
- macOS behavior and macOS tests remain unchanged.

## Phase 2: Linux Credential Storage

Goal: make Google OAuth, optional OAuth client secret storage, and MCP bearer
token storage secure and recoverable on Linux.

Status: Implementation complete as of 2026-06-13. Linux now uses
`LinuxSecretServiceStore` backed by Electron `safeStorage`, persists only
encrypted metadata under the app config path, hashes service/account storage
keys, forces plaintext encryption off, and refuses Electron's `basic_text`
fallback. The implementation reports ready, pending, unsupported, or error
states through Linux native diagnostics and keeps the public `SecretStore`
interface unchanged. Live desktop checks for GNOME Keyring ready, missing, and
locked states remain release gates under Phase 11. Verification:

- `pnpm typecheck`
- `pnpm exec vitest run --config vitest.config.ts src/main/credentials/secretStore.test.ts src/main/native/adapterContract.test.ts src/main/services/serviceContainer.test.ts`
- `pnpm test`
- `pnpm build`

Implementation tasks:

- Add the chosen Secret Service backend dependency. Default plan is `keytar`.
  Validate native-module compatibility with the repo's Electron version before
  wiring it into production.
- Add a Linux `SecretStore` implementation, for example
  `LinuxSecretServiceStore`, in or near `src/main/credentials/secretStore.ts`.
- Keep the public `SecretStore` interface unchanged unless a stateful status
  check needs an explicit async method.
- Update `defaultSecretStore()` in `src/main/services/serviceContainer.ts`:
  - `darwin`: `MacOsKeychainSecretStore`
  - `linux`: `LinuxSecretServiceStore`
  - other platforms: `UnsupportedSecretStore`
- Define Linux credential states:
  - `ready`: Secret Service is available and read/write/delete smoke succeeds.
  - `disabled` or `unsupported`: no compatible Secret Service provider exists.
  - `error`: service is locked, unavailable, denied by user, or returns an
    unexpected error.
- Ensure missing or locked Secret Service produces actionable messages in native
  diagnostics and Google/MCP setup flows.
- Ensure all token parse failures keep the existing behavior: delete corrupted
  token material and force reconnection instead of returning partial secrets.
- Update package config so any native `keytar` module is rebuilt and unpacked
  correctly for Linux packages.

Manual Linux credential checks:

- Fresh Ubuntu GNOME profile with GNOME Keyring available.
- Profile with Secret Service missing.
- Profile with Secret Service locked before app launch.
- Save OAuth client id and optional client secret.
- Connect Google account, quit app, relaunch, and confirm token persistence.
- Reset MCP bearer token, quit app, relaunch, and confirm revision changes.
- Confirm diagnostics and logs never include raw token or secret values.

Automated tests:

- Unit-test `LinuxSecretServiceStore` with a fake backend for read, write,
  delete, missing service, locked service, and unexpected backend error.
- Service-container tests should assert Linux chooses the Linux store when no
  explicit store is injected.
- Existing `MemorySecretStore` tests must continue to pass.

Acceptance criteria:

- Runtime Google OAuth can be enabled on Linux without plaintext storage.
- MCP bearer tokens persist on Linux without plaintext storage.
- Missing or locked Secret Service blocks credential-dependent features with a
  clear recoverable status, not a crash.

## Phase 3: Linux AppImage Packaging

Goal: produce a signed-status-neutral Linux AppImage preview artifact with
correct desktop metadata and no changes to macOS packaging.

Status: Implementation complete as of 2026-06-13 in commit `7b8c000`. The repo
now has Linux PNG icon assets, a Linux AppImage target in `electron-builder.yml`,
stable AppImage alias generation, an AppImage artifact smoke script, packaging
config coverage, release distribution docs, and Linux preview support docs.
Linux protocol metadata remains intentionally absent until the deep-link phase.

Verification completed:

- `pnpm exec electron-builder --linux AppImage --dir --publish never`
- `pnpm release:linux-artifacts`
- `pnpm release:checksums`
- `(cd release && sha256sum -c SHASUMS256.txt)`
- `pnpm release:smoke-appimage`
- `pnpm typecheck`
- `pnpm exec vitest run --config vitest.config.ts scripts/linux-packaging-config.test.ts`
- `pnpm test` (`60` Vitest files, `464` tests)
- `pnpm build`

Remaining manual release gates: launch the AppImage from terminal and file
manager, run the opt-in isolated launch smoke with
`HCB_APPIMAGE_SMOKE_LAUNCH=1`, confirm icon/window grouping on the supported
desktop matrix, and re-run macOS package smoke on a macOS host before shipping.

Implementation tasks:

- Extend `electron-builder.yml` with a Linux AppImage target:
  - keep the existing macOS config intact
  - add `linux.target: AppImage`
  - set Linux category to a productivity/office category accepted by
    electron-builder and desktop environments
  - provide Linux PNG icon assets in the expected directory layout
  - set desktop metadata for app name, generic name, categories, keywords, icon,
    and `StartupWMClass` where supported
  - include protocol metadata only when Phase 6 validates deep-link behavior
- Do not wrap AppImage output in zip or tar archives.
- Add npm scripts:
  - `build:release:linux`
  - `pack:linux:preview`
  - `release:linux:preview`
  - an AppImage smoke script once the artifact exists
- Extend release artifact helpers only where needed:
  - `scripts/release-checksums.ts` already recognizes `.AppImage`; verify this
    remains true after artifact naming changes.
  - Add a Linux alias helper if stable latest names are desired, for example
    `Hot-Cross-Buns-2-linux-x64.AppImage`.
- Add or update docs:
  - `docs/release/distribution.md` with Linux preview commands and expected
    artifact paths.
  - `docs/support/linux-preview-support.md` with AppImage run, chmod, checksum,
    known limitations, and support diagnostics guidance.
  - README badges/copy only after the Linux preview release gate passes.

Manual package checks:

- Build AppImage on Linux CI or a Linux host.
- Verify `chmod +x Hot-Cross-Buns-2-*.AppImage` launches the app.
- Launch from terminal and file manager.
- Confirm app icon appears.
- Confirm taskbar/window grouping uses the expected name/class.
- Confirm app data lands under expected XDG/Electron directories.
- Confirm uninstall/removal policy is documented.

Automated tests:

- Add a lightweight config test or script that verifies Linux target metadata is
  present without removing macOS targets.
- Add an AppImage smoke script that checks artifact existence, executable bit,
  embedded desktop metadata if feasible, and launch startup logs in a clean temp
  user-data directory.

Acceptance criteria:

- macOS DMG/zip release commands still work.
- Linux AppImage can be produced with electron-builder.
- Checksums cover AppImage artifacts.
- Public docs identify Linux as a technical preview, not broad Linux support.

## Phase 4: Linux Notifications

Goal: support local reminders on Linux only when Electron and the desktop
environment can show notifications.

Status: Closed as explicitly unsupported for the Linux technical preview as of
2026-06-13. The lower-level Electron notification implementation remains covered
for future validation runs, but default Linux preview capability reports now
mark notifications unsupported, direct scheduling returns no scheduled
notification, and docs say Linux desktop notifications are not part of the
public AppImage preview until GNOME/KDE packaged delivery and click-through are
validated.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts src/main/native/service.test.ts`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test` (`60` Vitest files, `468` tests)
- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts src/main/native/service.test.ts src/renderer/src/App.shell.test.tsx src/shared/ipc/contracts.test.ts`
- `pnpm typecheck`
- `pnpm build`
- Isolated Linux app capability probe on 2026-06-13 with
  `HCB_LINUX_ENABLE_UNVALIDATED_NATIVE_SHELL` unset reported
  `notifications: false` and a `notifications` capability state of
  `unsupported`.
- Secondary live host probe on 2026-06-13, before fail-closed default:
  Fedora 43 KDE Plasma 6 Wayland exposes `org.freedesktop.Notifications` as
  `Plasma/KDE 6.6.5` and accepted a direct D-Bus `Notify` request
  (`notification_id=133`). This is useful KDE environment evidence, but it does
  not validate app reminder delivery or click-through.

Remaining release gate: packaged AppImage QA must confirm Linux notification
status is explicitly unsupported and does not block startup, sync, tasks,
calendar, notes, export, or diagnostics. GNOME/KDE delivery and click-through
checks move to future validation builds.

Implementation tasks:

- Implement Linux notification detection with Electron `Notification.isSupported()`.
- Schedule notifications through Electron's `Notification` class, matching the
  existing `NativeNotificationRequest` contract.
- Treat notification permission query as unsupported unless Electron exposes a
  reliable Linux permission state for the target version.
- If notification creation or display fails, set native status to `error` and
  keep sync/task/calendar behavior unaffected.
- Keep notification content concise and privacy-conscious.

Manual checks:

- GNOME notification delivery.
- KDE notification delivery.
- Notification click opens/focuses the app and dispatches the intended action.
- Notifications disabled in Settings clear scheduled notifications.
- Notification failures are visible in diagnostics and do not crash the app.

Acceptance criteria:

- Linux notifications can be enabled only when supported.
- Unsupported or failed notifications are recoverable.
- Existing macOS notification behavior remains unchanged.

## Phase 5: Linux Global Shortcuts

Goal: support quick capture/global shortcuts where Linux desktop infrastructure
allows it, while treating denial and unsupported sessions as normal outcomes.

Status: Closed as explicitly unsupported for the Linux technical preview as of
2026-06-13. The lower-level X11/Wayland portal implementation remains covered
for future validation runs, and `NativeShellService` can wire the configured
`quickAdd.open` keybinding into the native adapter when that validation gate is
enabled. Default Linux preview capability reports now mark global shortcuts
unsupported, and docs say in-app quick add is the supported Linux capture path
until X11, Wayland portal, denial, conflict, and packaged AppImage dispatch are
validated.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test` (`60` Vitest files, `471` tests)
- `pnpm exec vitest run --config vitest.config.ts src/main/native/service.test.ts src/renderer/src/App.shell.test.tsx src/shared/ipc/contracts.test.ts`
- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts src/main/native/service.test.ts src/renderer/src/App.shell.test.tsx src/shared/ipc/contracts.test.ts`
- `pnpm typecheck`
- `pnpm build`
- Isolated Linux app capability probe on 2026-06-13 with
  `HCB_LINUX_ENABLE_UNVALIDATED_NATIVE_SHELL` unset reported
  `globalShortcuts: false` and a `globalShortcuts` capability state of
  `unsupported`.
- Secondary live host probe on 2026-06-13, before fail-closed default:
  Fedora 43 KDE Plasma 6 Wayland exposes XDG Desktop Portal `GlobalShortcuts`
  version `1`. This proves portal availability on the current secondary desktop
  only; shortcut registration, denial, conflict, and packaged AppImage dispatch
  move to future validation builds.

Remaining release gate: packaged AppImage QA must confirm Linux global shortcut
status is explicitly unsupported, in-app quick add remains available, and the
unsupported state does not block startup, sync, tasks, calendar, notes, export,
or diagnostics. X11/Wayland registration, denial, conflict, and packaged
AppImage dispatch checks move to future validation builds.

Implementation tasks:

- For X11 sessions, test Electron `globalShortcut` directly.
- For Wayland sessions, gate support behind Chromium/Electron
  `GlobalShortcutsPortal` support and XDG Desktop Portal availability.
- Detect session type with environment signals such as `XDG_SESSION_TYPE`, but
  treat it as diagnostic context, not proof that registration will work.
- Add capability fields or diagnostics for:
  - Wayland session detected
  - portal shortcut support detected or missing
  - registration conflict
  - user denial
- If registration fails, keep quick capture available in-app and show recovery
  guidance in Settings/Diagnostics.

Manual checks:

- Ubuntu GNOME Wayland with portal support.
- Ubuntu GNOME X11 where available.
- KDE Plasma Wayland.
- Shortcut conflict with an existing desktop shortcut.
- User denial or missing portal support.

Acceptance criteria:

- No Linux session crashes if a shortcut cannot be registered.
- Linux shortcut status is explicit and actionable.
- The app does not claim global hotkeys are reliable across all Linux desktops.

## Phase 6: Linux Tray And Status Area

Goal: provide optional tray/status-area behavior without making it central to
Linux usability.

Status: Closed as explicitly unsupported as of 2026-06-13. Electron `Tray` is
not enabled on Linux because the required GNOME and KDE status-icon validation
has not been completed. The Linux adapter now reports tray/status-area support
as explicitly unsupported, includes desktop-session context in sanitized
capability diagnostics, and keeps the main window as the supported control
surface. macOS menu-bar behavior remains owned by the macOS adapter.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts`
- `pnpm typecheck`
- `pnpm build`

Remaining manual release gates: GNOME without status-icon extensions, GNOME with
common appindicator/status-icon support, KDE Plasma status area, and Linux tray
action behavior if a later release decides to enable Electron `Tray`.

Implementation tasks:

- Implement tray with Electron `Tray` only after validating icon behavior on
  GNOME and KDE.
- Prefer a conventional context menu for Linux first. Do not port the macOS
  menu-bar panel assumptions directly unless the behavior is validated.
- Expose tray registration success, failure, and unsupported states through the
  existing native capability report.
- If GNOME hides status icons or requires extensions, report that as a caveat and
  keep the app usable through the main window.

Manual checks:

- GNOME default session without status-icon extensions.
- GNOME with common appindicator/status-icon support if used.
- KDE Plasma status area.
- Show/hide main window.
- Refresh action.
- Open settings.
- Quit.

Acceptance criteria:

- Linux tray is optional.
- Missing tray never blocks startup, sync, notifications, or Google/MCP setup.
- macOS menu bar panel behavior remains intact.

## Phase 7: Linux Custom Protocol And Deep Links

Goal: support `hotcrossbuns://` links after package metadata and desktop
registration are verified.

Status: Closed as explicitly unsupported as of 2026-06-13. Linux
`hotcrossbuns://` registration is not enabled because installed/integrated
AppImage desktop-entry behavior has not been manually verified. The Linux
adapter reports protocol registration as unsupported, AppImage metadata
continues to omit the scheme, the AppImage smoke script enforces that omission,
and the existing parser remains safe for malformed links without exposing raw
paths or tokens.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts scripts/linux-packaging-config.test.ts`
- `pnpm release:smoke-appimage`
- `pnpm typecheck`
- `pnpm build`

Remaining manual release gates: installed/integrated AppImage warm-start link
routing, cold-start link routing after renderer readiness, malformed-link
handling in the packaged app, and confirmation that Linux desktop integration
does not expose filesystem paths or tokens.

Implementation tasks:

- Keep deep links unsupported in the Linux adapter until AppImage desktop
  integration is validated.
- Add desktop metadata for the custom scheme only when packaging support is
  ready.
- Implement protocol registration/check behavior in the Linux adapter if
  Electron and the installed desktop entry can support it reliably.
- Preserve existing parser behavior in `src/main/native/deepLinks.ts`.
- Add explicit safe handling for malformed links and links to missing local
  resources.

Manual checks:

- Installed/integrated AppImage opens from `hotcrossbuns://` URL.
- Running app receives and routes a deep link.
- Closed app launches and routes a deep link after renderer readiness.
- Malformed links show a safe error.
- Links do not expose filesystem paths or tokens.

Acceptance criteria:

- Deep-link support is package-verified before public docs mention it.
- No malformed link can crash startup or expose sensitive data.

## Phase 8: Linux Autostart

Goal: decide whether open-at-login belongs in the Linux preview after core app,
credentials, packaging, and native shell behavior are stable.

Status: Closed as explicitly unsupported as of 2026-06-13. Linux open-at-login
is not enabled because a user-level autostart `.desktop` entry implementation
has not been validated across desktop environments. The Linux adapter reports
autostart as unsupported, does not write or remove autostart entries, and
Settings/Diagnostics expose the unsupported state.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts`
- `pnpm typecheck`
- `pnpm build`

Remaining manual release gates: user-level autostart `.desktop` create/remove
behavior, desktop-environment-specific login behavior, and uninstall/removal
policy if a later release enables autostart.

Implementation tasks:

- Keep autostart unsupported for the first Linux preview unless a simple desktop
  entry implementation is validated.
- If implemented, create/remove a user-level autostart `.desktop` entry through
  the platform adapter only.
- Report status and failures in native diagnostics.
- Document desktop-environment limitations.

Acceptance criteria:

- Autostart is optional and never blocks the Linux preview.
- Settings copy does not imply universal Linux support.

## Phase 9: Linux Update Checks

Goal: preserve preview-safe update behavior without package-manager conflicts.

Status: Implementation complete as of 2026-06-13. Release checking now uses a
shared native GitHub Releases helper with platform-specific asset preferences:
macOS prefers DMG then ZIP, while Linux prefers AppImage. Linux exposes manual
GitHub release checks through the native adapter and keeps in-place auto-update
disabled.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/native/githubReleaseUpdates.test.ts src/main/native/adapterContract.test.ts`
- `pnpm typecheck`
- `pnpm build`

Remaining manual release gates: confirm Settings check-for-updates opens the
right Linux release asset once a published AppImage release exists, and confirm
release copy does not imply automatic download or install.

Implementation tasks:

- Keep the current check-for-GitHub-release pattern.
- Make download asset selection platform-aware:
  - macOS should prefer DMG/zip as today.
  - Linux should prefer AppImage once release assets exist.
- Do not enable Electron's built-in `autoUpdater` for Linux.
- Do not claim automatic in-place updates for AppImage, DEB, or RPM until a
  package-specific updater decision is made and tested.

Acceptance criteria:

- Linux users can manually discover a newer GitHub Release.
- The app does not download or install Linux updates automatically.
- macOS update-check behavior remains compatible with current preview docs.

## Phase 10: OAuth, MCP, Networking, And Security

Goal: validate that shared network flows work correctly on Linux and remain
locked to local/safe boundaries.

Status: Implementation and automated security coverage complete as of
2026-06-13. Google OAuth loopback already binds to `127.0.0.1` and opens the
authorization URL through the native external URL opener. MCP startup now
materializes the bearer token in the configured `SecretStore` before binding,
binds only to `127.0.0.1`, rejects non-local, unauthorized, oversized, and
browser-origin requests, and writes only token-free runtime discovery metadata
under the Linux app config path. Diagnostics redaction now includes Linux
`/home/...` path examples.

Verification completed:

- `pnpm exec vitest run --config vitest.config.ts src/main/google/oauthLoopback.test.ts src/main/mcp/server.test.ts src/main/mcp/runtimeFile.test.ts src/main/mcp/keychainCredentials.test.ts src/main/services/serviceContainer.test.ts src/shared/redaction.test.ts src/main/ipc/diagnosticsRedaction.test.ts src/main/native/adapterContract.test.ts`

Remaining manual release gates: Ubuntu GNOME OAuth browser round trip, firewall
or security-tool callback behavior on the supported distro path, token refresh
after an app restart, and external CLI MCP smoke against a packaged AppImage
with Secret Service ready, missing, and locked states.

Implementation tasks:

- Verify default browser handoff from Linux through the native adapter's
  external URL opener.
- Verify Google OAuth loopback listener on localhost.
- Verify firewall/security tools do not break the supported Ubuntu GNOME path.
- Verify MCP binds only to `127.0.0.1`.
- Verify MCP rejects non-local or unauthorized requests.
- Verify runtime files are written under Linux config paths and do not contain
  raw bearer tokens.
- Re-run diagnostics redaction tests with Linux path examples.

Manual checks:

- OAuth connect with browser round trip.
- OAuth disconnect and reconnect.
- Token refresh after app restart.
- MCP enabled, disabled, token reset, and external CLI smoke.
- Logs and diagnostics inspected for token/path redaction.

Acceptance criteria:

- OAuth and MCP work on Linux only with OS-backed secret storage.
- No sensitive material appears in renderer IPC, logs, diagnostics, or support
  exports.

## Phase 11: Linux QA Matrix

Status: Automated Linux preview gate pass complete as of 2026-06-13. The
standard unit suite passes when allowed to run through the long
`sqliteDomainServices.test.ts` file, the production build passes, release bundle
review passes, AppImage checksum and metadata smoke pass, the opt-in isolated
AppImage launch smoke passes, Playwright Electron launch/navigation smoke
passes on Linux, and the local performance smoke writes a fresh report. The
Playwright smoke was made platform-aware for native text undo shortcuts so Linux
uses `Control+Z` while macOS continues to use `Meta+Z`.

Verification completed:

- `pnpm typecheck`
- `pnpm test` (`61` Vitest files, `479` tests)
- `pnpm build`
- `pnpm release:review-bundle`
- `(cd release && sha256sum -c SHASUMS256.txt)`
- `pnpm release:smoke-appimage`
- `HCB_APPIMAGE_SMOKE_LAUNCH=1 pnpm release:smoke-appimage`
- `pnpm test:smoke`
- `pnpm test:perf`
- Secondary Fedora 43 KDE Plasma 6 Wayland probe on 2026-06-13, before
  fail-closed notification/shortcut defaults:
  Freedesktop notification service available, notification request accepted,
  XDG Desktop Portal `GlobalShortcuts` available, isolated app capability
  report schema-valid for the current session, Linux tray/deep-link/autostart
  remain unsupported, and credential storage remains blocked when Electron
  would fall back to plaintext.
- Linux release-prep rerun on 2026-06-13:
  `pnpm release:linux:preview` passed (`61` Vitest files, `482` tests),
  regenerated the `5.0.0` AppImage plus stable Linux aliases, and wrote
  matching checksums. `pnpm typecheck`, `(cd release && sha256sum -c
  SHASUMS256.txt)`, `pnpm release:smoke-appimage`,
  `HCB_APPIMAGE_SMOKE_LAUNCH=1 pnpm release:smoke-appimage`,
  `pnpm test:smoke`, and `pnpm test:perf` also passed. The AppImage smoke
  script now terminates the packaged app process group after collecting startup
  logs so launch smoke does not leak a running AppImage.

Remaining manual release gates: Ubuntu GNOME terminal and file-manager launch,
real desktop icon/window grouping, OAuth browser round trip, Secret Service
ready/missing/locked checks, live MCP CLI smoke against the packaged AppImage,
and confirmation that Linux notifications and global shortcuts are unsupported
in the packaged preview.

Required automated gates before any Linux preview release:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- release bundle review
- SQLite migration/repository tests
- IPC contract tests
- MCP contract tests
- Google transport mock tests
- Playwright launch/navigation smoke on Linux
- AppImage smoke script
- performance smoke report on Linux

Required manual Linux checks:

- Ubuntu LTS GNOME AppImage launch from terminal.
- Ubuntu LTS GNOME AppImage launch from file manager.
- AppImage launched with isolated `HCB_ALLOW_PACKAGED_USER_DATA_DIR=1` and
  `HCB_USER_DATA_DIR`.
- App icon and taskbar grouping.
- Window open, close, hide/show, and quit.
- OAuth browser round trip.
- Secret Service ready, missing, and locked states.
- MCP localhost smoke.
- Notifications, if implemented.
- Global shortcut on X11, if implemented.
- Global shortcut on Wayland, if implemented.
- Tray behavior on GNOME and KDE, if implemented.
- `hotcrossbuns://` protocol smoke, if implemented.
- Package removal/uninstall data policy documented.

Performance checks:

- AppImage cold launch shell visible.
- Warm launch shell visible.
- Command palette open.
- In-app quick capture open.
- Local search against medium fixture.
- Task list scroll against large fixture.
- Calendar month navigation against large fixture.
- SQLite query-plan report.

## Phase 12: Documentation And Product Copy

Goal: keep user-facing claims accurate.

Status: Complete as of 2026-06-13. User-facing docs now describe the Linux
work as an AppImage technical preview instead of general Linux support. The
README, public docs site, privacy page, docs index, QA plan, release
distribution docs, Linux preview support doc, and manual Linux native-shell
checklist all call out preview scope, AppImage packaging, OS-backed credential
storage, no plaintext fallback, manual GitHub release updates, and unsupported
Linux notifications, global shortcuts, tray/status-area, deep-link, autostart,
and in-place update behavior.
Remaining unchecked release-readiness items below require live Linux desktop
validation and are not claimed as complete by this docs pass.

Implementation tasks:

- Update `docs/ports/linux-port.md` as implementation decisions land.
- Add `docs/testing/manual-linux-native-shell.md`.
- Add `docs/support/linux-preview-support.md`.
- Update `docs/release/distribution.md` with Linux preview build and install
  steps.
- Update README only after Linux preview gates pass:
  - keep macOS download/install instructions
  - add Linux technical preview instructions
  - clearly label AppImage as preview
  - list unsupported Linux native features honestly
- Update public docs site only after the release artifact exists.

Acceptance criteria:

- User-facing docs do not say Linux is generally supported before the preview is
  released.
- Support docs include diagnostics, known limitations, and rollback/removal
  guidance.

## Suggested Implementation Order

1. Adapter factory and non-claiming Linux adapter.
2. Linux `SecretStore` and credential diagnostics.
3. Linux AppImage packaging.
4. Linux OAuth and MCP live smoke.
5. Notifications.
6. Global shortcuts.
7. Tray/status area.
8. Deep links.
9. Optional autostart.
10. Linux release docs and README updates.

## Release Readiness Checklist

- [x] macOS tests and packaging still pass.
- [x] Linux adapter selected on Linux without importing mac adapter code.
- [x] Linux capability report is schema-valid.
- [x] Linux credential storage uses Secret Service/libsecret and no plaintext
      fallback.
- [x] AppImage builds on a Linux host or Linux CI runner.
- [x] AppImage checksum is generated and verified.
- [ ] OAuth browser round trip works on Ubuntu GNOME.
- [x] MCP binds to `127.0.0.1` and uses OS-backed bearer token storage.
- [x] Notifications are either validated or explicitly unsupported.
- [x] Global shortcuts are either validated per session type or explicitly
      unsupported.
- [x] Tray behavior is either validated per desktop environment or explicitly
      unsupported.
- [x] Deep links are either package-validated or explicitly unsupported.
- [ ] Linux manual QA matrix is complete.
- [x] Linux support docs are written.
- [x] README/public copy is updated only with accurate preview claims.

## Phase 13: Windows Technical Preview

Goal: port the validated desktop release path to Windows without claiming
public Windows support before installer, identity, credential, shell, and
SmartScreen behavior are proven on Windows.

Status: Windows preview scaffold implemented as of 2026-06-13. The repo now has
an `electron-windows-preview` native adapter, Windows safeStorage-backed secret
storage, AppUserModelID setup, NSIS packaging config, Windows release scripts,
stable installer alias generation, an NSIS artifact smoke script, Windows
manual QA checklist, a manual Windows Preview Validation GitHub Actions
workflow, and release distribution docs. Public Windows release is not yet
validated.

Fedora cross-package attempt on 2026-06-13: `pnpm pack:win:preview` completed
the Windows release build and produced `release/win-unpacked/Hot Cross Buns
2.exe`, then electron-builder stopped before NSIS installer creation because
Wine is not installed on this Linux host. Continue Windows release validation on
a Windows host/CI runner, or install Wine for Linux cross-packaging before
re-running `pnpm pack:win:preview`.

Release script hardening on 2026-06-13: `build:release:*` now uses
`scripts/release-build.ts`, and preview packaging now uses
`scripts/electron-builder-preview.ts`, so Windows validation does not depend on
POSIX inline environment assignment syntax.

Windows artifact smoke hardening on 2026-06-14: `pnpm release:smoke-nsis`
now verifies the versioned Windows x64 installer, stable Windows aliases,
`SHASUMS256.txt`, and per-artifact `.sha256` sidecars agree before manual
installed-app QA starts, and stable aliases must byte-match the versioned
installer. The GitHub Actions workflow also fails on a stable installer checksum
mismatch instead of only printing hashes.

Windows identity hardening on 2026-06-14: the app now applies the stable
AppUserModelID synchronously during main-process startup on `win32`, before
`app.whenReady()` and before any window or notification setup. Installed-build
Start Menu/taskbar/notification behavior still requires Windows 11 QA.

Preview artifact alias hardening on 2026-06-14: Linux and Windows alias helpers
now only copy versioned Hot Cross Buns release artifact names into stable aliases
and ignore unrelated helper binaries in `release/`. Focused tests cover Linux
AppImage aliases, Windows NSIS aliases, and missing versioned artifacts.

Deep-link launch hardening on 2026-06-14: main-process startup now scans
validated `hotcrossbuns://` argv entries for Windows/Linux cold starts and uses
Electron's single-instance `second-instance` event for warm starts. The
schema-backed parser still rejects malformed links before routing. Windows
installer protocol registration and installed-app cold/warm link QA remain
manual release gates.

Public copy gate hardening on 2026-06-14: README, docs site copy, privacy copy,
platform specs, and `v5.0.0` release notes now describe Linux AppImage and
Windows NSIS artifacts as prepared but gated on target-OS manual QA before
public upload. This does not complete the Ubuntu GNOME or Windows 11 manual
release gates.

Linux CI gate hardening on 2026-06-14: `.github/workflows/linux-preview.yml`
adds a manual `Linux AppImage Preview Validation` workflow on `ubuntu-latest`
that runs `pnpm release:linux:preview`, checksum verification, AppImage metadata
and launch smoke under Xvfb, Electron smoke, performance smoke, and artifact
upload. Ubuntu GNOME desktop/manual QA remains a separate release gate.

Linux AppImage smoke hardening on 2026-06-14: `pnpm release:smoke-appimage`
now verifies the versioned AppImage, stable Linux aliases, executable bits,
`SHASUMS256.txt`, and per-artifact `.sha256` sidecars before metadata
extraction or optional launch smoke. The Linux alias helper also preserves the
versioned AppImage executable mode on stable aliases. Packaged QA data isolation
now uses a fail-closed `HCB_ALLOW_PACKAGED_USER_DATA_DIR=1` gate before honoring
`HCB_USER_DATA_DIR`. The Linux preview workflow now installs the Ubuntu FUSE 2
compatibility package needed for AppImage launch smoke, and early AppImage launch
failures include captured stdout/stderr.

Linux/Windows preview workflow rerun on 2026-06-14: both manual GitHub Actions
workflows are active on `origin/main`. Linux run `27486500412` passed AppImage
build, checksum, and metadata checks, then failed launch smoke because the
AppImage `chrome-sandbox` helper is not setuid root on the hosted runner. The
launch-smoke step now passes Electron's testing-only `--no-sandbox` flag through
an explicit CI env gate. Windows run `27486500420` failed during dependency
install because `windows-latest` redirected to the Windows Server 2025 / Visual
Studio 2026 image and `node-gyp` could not detect that toolchain for
`better-sqlite3`; the Windows preview workflow now pins `windows-2022`.
Follow-up automated validation on 2026-06-14: Linux run `27487088365` and
Windows run `27487088467` passed on commit `01b6d50`. Linux completed
`pnpm release:linux:preview`, `sha256sum -c SHASUMS256.txt`,
AppImage metadata smoke, AppImage launch smoke under `xvfb`, Electron smoke,
performance smoke, and artifact upload. Windows completed
`pnpm release:win:preview`, `pnpm release:smoke-nsis`, PowerShell
`Get-FileHash` checksum verification, Electron smoke, performance smoke, and
artifact upload.

Stable artifact alias hardening on 2026-06-14: Linux AppImage and Windows NSIS
smoke tests now reject stable aliases that have internally valid checksums but do
not byte-match the selected versioned release artifact.

Linux/Windows performance gate hardening on 2026-06-14: platform preview
workflows set `HCB_PERF_REQUIRE_ELECTRON=1`, so `pnpm test:perf` still writes
report artifacts but fails the validation job if cold or warm Electron launch
timings are skipped.

Linux/Windows update asset preference hardening on 2026-06-14: mocked GitHub
Release metadata tests now cover Linux x64 AppImage preference and Windows x64
NSIS `.exe` preference before generic installer fallbacks. Live Settings
check-for-updates validation still requires published or draft release assets.
Live release asset check on 2026-06-14: published `v5.0.0` contains macOS
assets plus `SHASUMS256.txt` only, so Linux AppImage and Windows `.exe`
Settings update-check verification remains blocked until a draft or published
release contains those platform artifacts. No Linux/Windows upload should happen
before the manual target-OS QA gates pass.

Windows SmartScreen documentation on 2026-06-14:
`docs/release/windows-signing-smartscreen.md` now documents the unsigned
internal-preview policy, expected Microsoft Defender SmartScreen/browser warning
classes, signing paths to evaluate, and evidence to capture during Windows 11
manual QA. This does not verify actual SmartScreen behavior for this app's NSIS
artifact.

Windows preview support documentation on 2026-06-14:
`docs/support/windows-preview-support.md` now documents checksum verification,
expected NSIS install path, unsigned-preview warnings, diagnostics expectations,
and retained user-data policy. Actual Windows uninstall cleanup remains a
Windows 11 manual QA gate.

Release documentation refresh on 2026-06-14: `docs/release/notes/v5.0.0.md`,
`docs/release/distribution.md`, `docs/ports/windows-port.md`,
`docs/support/windows-preview-support.md`,
`docs/testing/manual-windows-native-shell.md`, and `docs/ports/linux-port.md`
now distinguish Linux/Windows automated CI passes from target-desktop manual QA
blockers. They record Linux run `27487088365`, Windows run `27487088467`, and
keep publish/upload guidance gated on Ubuntu GNOME and Windows 11 installed-app
manual QA.

Cross-platform smoke hardening on 2026-06-14: Playwright smoke now asserts the
seeded SQLite cache is visible through diagnostics, native diagnostics report
the expected platform adapter and development package format, diagnostics
collection is supported, redaction guarantees are exposed, and native path
diagnostics omit raw `/Users`, `/home`, and `C:\Users\...` prefixes. Local
`pnpm test:smoke` passed after this change.

Implementation tasks:

- [x] Decide preview scope: Windows 11 x64 first, NSIS installer first,
      unsigned only for internal preview unless signing is configured.
- [x] Add Windows packaging: `win`/`nsis` electron-builder config, ICO asset,
      `build:release:win`, `pack:win:preview`, `release:win:preview`,
      `release:win-artifacts`, and `release:smoke-nsis`.
- [x] Add Windows CI validation entry point:
      `.github/workflows/windows-preview.yml` runs the Windows preview release
      gate, installer artifact smoke, checksum output, Electron smoke, and
      performance smoke on `windows-2022`.
- [x] Add Windows native adapter: app paths, AppUserModelID, tray,
      global shortcuts, notifications, protocol registration, autostart,
      manual GitHub release checks, external opens, diagnostics, and capability
      reporting.
- [x] Add Windows credential storage: Electron safeStorage-backed encrypted
      metadata store for Google OAuth and MCP bearer tokens, with no plaintext
      fallback.
- [ ] Validate core runtime on Windows: SQLite native module, OAuth browser
      round trip, MCP loopback, Windows Defender/firewall behavior, and
      diagnostics redaction.
- [ ] Validate native shell behavior on Windows: tray, global shortcuts,
      notifications, deep links, autostart, Start Menu identity, taskbar
      grouping, and uninstall behavior.
- [ ] Complete Windows release validation: `pnpm release:win:preview`,
      checksum verification, `pnpm release:smoke-nsis`, Playwright smoke on
      Windows, performance smoke on Windows, manual QA notes, and release notes.

Required automated gates before Windows-host validation:

- `pnpm typecheck`
- `pnpm exec vitest run --config vitest.config.ts src/main/native/adapterContract.test.ts src/main/credentials/secretStore.test.ts src/main/native/deepLinkLaunchArgs.test.ts scripts/linux-packaging-config.test.ts`
- `pnpm build`
- `pnpm release:review-bundle`

Required Windows manual checks:

- Install with NSIS.
- Launch from installer finish action.
- Launch from Start Menu.
- Launch from desktop shortcut if created.
- App icon and taskbar grouping are correct.
- Diagnostics report platform `win32`, adapter `electron-windows-preview`, and
  package format `nsis`.
- Google OAuth browser round trip.
- Token refresh after app restart using Windows safeStorage.
- MCP localhost smoke against installed app.
- Tray menu show/hide, quick capture, refresh, settings, and quit.
- Global shortcut success and conflict handling.
- Windows notifications display and click through.
- `hotcrossbuns://` warm-start links route through `second-instance`; cold-start
  links route from validated launch argv.
- Open-at-login enable/disable.
- Settings check-for-updates finds Windows installer assets.
- Uninstall behavior and retained data policy are documented.
- SmartScreen/signing behavior is documented.

## Independent Agent Handoff: Finish Linux And Windows Ports

Status at pause on 2026-06-13: Linux automated release prep is substantially
complete, Windows scaffold is implemented, and release validation was paused
before any Windows-host run. Do not mark either port as fully rounded out until
the unchecked items below have direct evidence from the named target OS.

Latest local validation evidence before pause:

- `pnpm test` passed on Fedora 43 KDE: `61` Vitest files, `489` tests.
- `pnpm test:smoke` passed on Fedora 43 KDE: `1` Playwright Electron smoke
  test.
- `pnpm test:perf` passed and wrote `artifacts/perf/latest.json` plus
  `artifacts/perf/latest.md`.
- Earlier Windows-prep checks passed locally: `pnpm typecheck`, the focused
  Windows/native/credential packaging Vitest run, `pnpm build:release:win`,
  and `pnpm release:review-bundle`.
- `wine` is not installed on this host.
- Docker is installed, but this user cannot access `/var/run/docker.sock`, so
  Wine-in-Docker packaging is unavailable from this session.
- `.github/workflows/windows-preview.yml` and `.github/workflows/linux-preview.yml`
  are committed on `main`/`origin/main` and visible as active GitHub Actions
  workflows.

Linux remaining work:

- [ ] Run the packaged AppImage on Ubuntu LTS GNOME, not Fedora only.
- [ ] Launch the AppImage from a terminal and record stdout/stderr plus exit
      behavior.
- [ ] Launch the AppImage from the file manager and verify no shell-only
      assumptions are required.
- [ ] Verify the app icon, window title, and taskbar/window grouping on Ubuntu
      GNOME.
- [ ] Run the app with
      `HCB_ALLOW_PACKAGED_USER_DATA_DIR=1 HCB_USER_DATA_DIR=<absolute temp dir>`
      and confirm no real user data is touched during QA.
- [ ] Complete Google OAuth browser round trip on Ubuntu GNOME.
- [ ] Validate Secret Service states on Ubuntu GNOME:
      ready/unlocked, locked, and missing/unavailable. Confirm there is no
      plaintext token fallback.
- [ ] Run a live MCP localhost smoke against the packaged AppImage. Confirm it
      binds to `127.0.0.1`, requires the OS-backed bearer token, and rejects
      unauthorized requests.
- [ ] Open Settings diagnostics from the packaged AppImage and confirm paths,
      adapter id, package format, credential status, and redaction are accurate.
- [ ] Confirm packaged Linux notifications remain explicitly unsupported in
      diagnostics and UI copy.
- [ ] Confirm packaged Linux global shortcuts remain explicitly unsupported and
      in-app quick add still works.
- [ ] Confirm tray/status-area, `hotcrossbuns://` protocol handling, autostart,
      and in-place auto-update are either still unsupported by design or have
      fresh implementation plus manual QA before any support claim changes.
- [ ] Verify Settings check-for-updates prefers Linux AppImage assets once a
      draft or published GitHub release contains the Linux artifacts.
- [x] Re-run the Linux release gate after manual fixes:
      `pnpm release:linux:preview`,
      `(cd release && sha256sum -c SHASUMS256.txt)`,
      `pnpm release:smoke-appimage`,
      `HCB_APPIMAGE_SMOKE_LAUNCH=1 pnpm release:smoke-appimage`,
      `pnpm test:smoke`, and `pnpm test:perf`.
- [x] Re-dispatch the `Linux AppImage Preview Validation` workflow on GitHub
      Actions after the CI AppImage launch-smoke fix is pushed.
- [ ] Update `docs/release/notes/v5.0.0.md` with the final Linux QA result,
      unsupported feature list, artifact names, and checksum instructions.
- [ ] Upload Linux AppImage artifacts only after the Ubuntu GNOME manual matrix
      is complete.

Windows remaining work:

- [x] Commit/push the Windows scaffold and `.github/workflows/windows-preview.yml`
      to `main`/`origin/main` so GitHub Actions can see the workflow.
- [x] Re-dispatch the `Windows Preview Validation` workflow on GitHub Actions
      after the `windows-2022` runner pin is pushed, or run these commands on
      Windows:
      `pnpm release:win:preview`,
      `pnpm release:smoke-nsis`,
      `pnpm test:smoke`, and `pnpm test:perf`.
- [x] Confirm the Windows preview artifacts exist:
      `release/Hot-Cross-Buns-2-5.0.0-windows-x64.exe`,
      `release/Hot-Cross-Buns-2-windows.exe`,
      `release/Hot-Cross-Buns-2-windows-x64.exe`,
      matching `.sha256` files, and `release/SHASUMS256.txt`.
- [x] Verify the Windows installer checksum with PowerShell:
      `Get-FileHash .\release\Hot-Cross-Buns-2-windows-x64.exe -Algorithm SHA256`.
- [ ] Install the NSIS preview on Windows 11 x64.
- [ ] Launch from installer finish action, Start Menu, and desktop shortcut.
- [ ] Confirm AppUserModelID, app icon, Start Menu identity, and taskbar
      grouping are correct.
- [ ] Confirm SQLite native module loads in the installed Windows app and real
      planner CRUD flows work.
- [ ] Complete Google OAuth browser round trip on Windows and note any Defender
      or firewall prompts.
- [ ] Restart the app and confirm Windows safeStorage persists Google OAuth and
      MCP bearer tokens without plaintext fallback.
- [ ] Run a live MCP localhost smoke against the installed Windows app.
- [ ] Validate Windows tray menu: show/hide, quick capture, refresh, settings,
      and quit.
- [ ] Validate global shortcut success path and conflict handling.
- [ ] Validate Windows notifications display and click through with the correct
      app identity.
- [ ] Validate `hotcrossbuns://` warm-start and cold-start deep links.
- [ ] Validate open-at-login enable/disable and persistence across app restart.
- [ ] Verify Settings check-for-updates prefers Windows `.exe` assets.
- [ ] Uninstall the app and document installer cleanup plus retained user-data
      behavior.
- [x] Document expected SmartScreen/signing behavior for unsigned preview
      artifacts. Do not make a public Windows support claim without an explicit
      code-signing plan.
- [ ] Update `docs/release/notes/v5.0.0.md`,
      `docs/ports/windows-port.md`, `docs/release/distribution.md`, and
      `docs/testing/manual-windows-native-shell.md` with actual Windows runner
      and manual QA evidence.
- [ ] Upload Windows NSIS artifacts only after Windows CI or Windows-host
      packaging, checksum verification, installer smoke, and manual installed
      app QA pass.

Completion definition for the next agent:

- Linux can be called rounded out only when the Ubuntu GNOME manual matrix is
  complete, final Linux release artifacts/checksums are regenerated, and release
  notes accurately describe preview scope and unsupported native features.
- Windows can be called rounded out only when NSIS artifacts are built on a
  Windows host or Windows CI runner, installed-app QA passes on Windows 11 x64,
  SmartScreen/signing expectations are documented, and release notes accurately
  describe unsigned preview scope.
- If any feature changes from unsupported to supported, update adapter
  capability reporting, docs, manual QA checklists, and release notes in the
  same change.

## External References

- Electron global shortcuts:
  https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron notifications:
  https://www.electronjs.org/docs/latest/tutorial/notifications
- Electron safeStorage and Linux key providers:
  https://www.electronjs.org/docs/latest/api/safe-storage
- electron-builder Linux targets:
  https://www.electron.build/docs/linux/
- electron-builder AppImage target:
  https://www.electron.build/docs/appimage/
- FreeDesktop Desktop Entry Specification:
  https://specifications.freedesktop.org/desktop-entry-spec/latest/
- XDG Desktop Portal global shortcuts:
  https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html
- Secret Service API:
  https://specifications.freedesktop.org/secret-service-spec/latest/
