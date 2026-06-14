# Linux Port

Linux is the first non-Mac port for Hot Cross Buns 2. Treat it as a technical preview before claiming broad Linux parity.

## Target Scope

Initial supported target:

- Ubuntu LTS on GNOME, current stable release at implementation time.

Secondary manual-check targets:

- Fedora Workstation on GNOME.
- KDE Plasma on a mainstream distro.
- One Wayland session and one X11 session.

Do not claim universal Linux support. Linux desktop behavior varies by distribution, desktop environment, compositor, portal setup, package format, and user security settings.

## Package Targets

The current technical-preview package target is AppImage because it is portable and maps well to preview distribution. Add DEB/RPM only after the core Linux app is useful.

Recommended order:

1. AppImage technical preview.
2. DEB for Debian/Ubuntu users.
3. RPM for Fedora/openSUSE users.
4. Flatpak only if sandboxing and portal behavior become a deliberate product goal.

AppImage desktop integration depends on `.desktop` metadata. AppImages carry a desktop file in the AppDir, and desktop files follow the FreeDesktop Desktop Entry Specification.

The AppImage config currently includes:

- app name: Hot Cross Buns 2
- generic name: Planner
- category: Office
- icon metadata from `build/icons/<size>x<size>.png`
- `StartupWMClass=hot-cross-buns-2`

Linux package metadata intentionally does not register `hotcrossbuns://` until deep-link behavior is validated.

## Linux Paths

Use Electron/app conventions where possible, but verify paths through the platform adapter.

Expected path categories:

- config/settings
- application data
- cache
- logs
- crash/diagnostics artifacts
- temporary performance fixture databases

Do not hardcode macOS `Application Support` paths or Windows `%APPDATA%` assumptions in shared code.

## Credential Storage

Implemented credential strategy:

- Use `LinuxSecretServiceStore` through the shared `SecretStore` abstraction.
- Use Electron `safeStorage` only when it selects an OS-backed Linux provider such as `gnome_libsecret`, `kwallet`, `kwallet5`, or `kwallet6`.
- Reject Electron `basic_text` plaintext fallback.
- Persist encrypted metadata under the app config path and hash service/account storage keys.
- Detect missing or locked secret service at runtime.
- Provide clear setup guidance when credentials cannot be saved.
- Never fall back to plaintext token storage.

Linux preview must test:

- secret service available and unlocked
- secret service missing
- secret service locked
- token reset
- app restart after token storage

## Tray / Status Area

Linux tray support varies. The platform adapter must expose tray capability and diagnostics rather than assuming the tray exists.

Current technical-preview decision: Linux tray/status-area support is explicitly
unsupported until GNOME and KDE status-icon behavior is manually validated. The
main window remains the supported control surface, and Settings/Diagnostics
show tray as unsupported with desktop-session context where available.

Required behavior:

- If tray registration succeeds, support show/hide, quick capture, refresh, settings, quit.
- If tray registration fails or the desktop environment hides status icons, keep the main app usable.
- Settings must show tray status and a diagnostic reason where available.

Manual QA must cover GNOME and KDE separately.

## Global Shortcuts

Linux global shortcuts are the highest-risk native feature.

Current technical-preview decision: Linux global shortcuts are explicitly
unsupported. The main window, command palette, and in-app quick add remain the
supported capture paths.

Future validation rules:

- On Wayland, prefer the XDG Desktop Portal global shortcuts path where Electron/Chromium support is available.
- On X11, test Electron `globalShortcut` directly.
- If registration fails, show an actionable settings error and keep quick capture available in-app.
- Do not claim global hotkeys are reliable on all Linux desktops.

Electron documents a `GlobalShortcutsPortal` feature flag for Wayland sessions. XDG Desktop Portal global shortcuts are session-bound and user-mediated, so the UI must tolerate user denial or missing portal support.

Internal validation implementation:

- Electron's `GlobalShortcutsPortal` feature switch can be enabled before app
  ready on Linux so Wayland sessions can use the portal path when available
- X11 sessions can attempt Electron `globalShortcut` registration directly
- Wayland sessions report shortcut support only when the XDG Desktop Portal
  GlobalShortcuts interface is detected
- registration conflicts, portal denial, or compositor blocks return explicit
  recovery guidance while the in-app quick add path remains available
- public preview builds keep this path disabled until the manual matrix is
  complete

## Notifications

Electron sends Linux notifications through `libnotify` on desktop environments following the Desktop Notifications Specification. The adapter must check support and expose failures as diagnostics.

Current technical-preview decision: Linux notifications are explicitly
unsupported. Reminders remain visible inside the app, but the public preview
does not schedule desktop notifications on Linux.

Internal validation implementation:

- the Linux adapter enables local notification scheduling only when
  `Notification.isSupported()` is true
- permission state remains unsupported because Electron does not expose a
  reliable Linux permission query for the target runtime
- scheduled notifications use Electron's main-process `Notification` class and
  retain active notification objects for click routing
- notification display failures update native diagnostics without interrupting
  sync, tasks, or calendar state
- public preview builds keep this path disabled until GNOME/KDE delivery and
  click-through validation are complete

Future required behavior:

- notification scheduling can be enabled only when notification support is detected
- failure to show a notification must not break sync or task/event data
- notification content should remain concise and privacy-conscious

## Custom Protocols And Deep Links

The Linux port must support `hotcrossbuns://` links only after package metadata and desktop registration are verified.

Current technical-preview decision: Linux `hotcrossbuns://` registration is
explicitly unsupported. AppImage desktop metadata intentionally omits the scheme,
the Linux adapter reports protocol registration as unsupported, and deep-link
parser behavior remains covered without enabling package registration.

Required checks:

- protocol opens the installed app
- deep link routes to task/event/note where local data exists
- malformed links show a safe error
- protocol handling does not expose raw filesystem paths or tokens

## Autostart

Open-at-login should be treated as optional for Linux preview. Implement only through a platform adapter and document desktop-environment limitations.

Current technical-preview decision: Linux open-at-login is explicitly
unsupported. The adapter does not create or remove user-level autostart
`.desktop` entries, and Settings/Diagnostics report the unsupported state.

Do not block the Linux preview on autostart.

## Updater Strategy

Use check-for-new-version first. Do not promise seamless in-place auto-update in Linux preview.

Electron's built-in `autoUpdater` does not support Linux. electron-builder's `electron-updater` supports Linux targets such as AppImage, DEB, Pacman, and RPM, but the product should still respect distro package manager expectations and package-specific behavior before enabling automatic updates.

Current implementation:

- Linux uses the shared GitHub Releases check-for-new-version flow
- Linux release asset selection prefers x64 `.AppImage` assets before generic
  AppImage fallbacks
- no Linux update is downloaded or installed automatically
- in-place AppImage/DEB/RPM updates remain explicitly unclaimed

## OAuth, MCP, And Networking

Required Linux checks:

- default browser opens Google OAuth consent
- localhost loopback callback succeeds
- firewall/security tools do not block normal callback path on supported distros
- MCP binds only to `127.0.0.1`
- MCP rejects non-local/unauthorized requests
- no tokens appear in logs, diagnostics, or renderer state

Current implementation:

- Google OAuth loopback binds to `127.0.0.1` with an ephemeral port and hands the
  authorization URL to the native adapter's external URL opener.
- MCP binds to `127.0.0.1` and rejects non-local request contexts, browser
  origins, missing bearer tokens, invalid bearer tokens, and oversized requests.
- MCP startup loads or creates the bearer token through `SecretStore` before the
  listener is reported running.
- The MCP runtime discovery file is written under the app config directory with
  mode `0600` and contains only non-secret loopback metadata.
- The HCB CLI discovers the Linux runtime file and uses an Electron
  `safeStorage` helper to decrypt the OS-backed bearer token, refusing
  Electron's `basic_text` plaintext fallback.
- Diagnostics redaction covers bearer/OAuth secrets and Linux `/home/...` paths.

Remaining release gates:

- OAuth browser round trip on Ubuntu GNOME.
- Firewall/security-tool behavior on the supported Ubuntu path.
- Token refresh after app restart with Secret Service ready, missing, and locked
  states.
- External CLI MCP smoke against a packaged AppImage.
- Optional packaged MCP smoke automation now exists:
  `HCB_APPIMAGE_SMOKE_LAUNCH=1 HCB_PACKAGED_MCP_SMOKE=1 pnpm
  release:smoke-appimage` enables read-only MCP on a random loopback port,
  verifies unauthorized `401` rejection, and runs `hcb doctor` through CLI
  runtime discovery with a seeded smoke token. It still requires Ubuntu GNOME
  Secret Service/keyring validation before the manual MCP gate is complete.

## Performance Checks

Required Linux performance checks:

- AppImage cold launch shell visible
- installed package cold launch shell visible if DEB/RPM exists
- command palette open
- quick capture open through in-app path and global shortcut when supported
- local search against medium fixture
- task list scroll against large fixture
- calendar month navigation against large fixture
- SQLite query-plan report

## Linux Manual QA Checklist

Before Linux technical preview:

- launch from terminal
- launch from file manager/AppImage
- launch from desktop entry if integrated
- app icon appears correctly
- window/taskbar grouping is correct
- Settings and Diagnostics report tray/status-area as unsupported
- Settings and Diagnostics report global shortcuts as unsupported
- Settings and Diagnostics report notifications as unsupported
- OAuth browser round trip
- MCP localhost smoke test
- Settings and Diagnostics report `hotcrossbuns://` registration as unsupported
- package uninstall leaves user data policy documented

## Known Risks

- Wayland global shortcuts may depend on portal support and user approval.
- GNOME status icon/tray behavior may require extensions or may not display like macOS.
- AppImage desktop integration can vary depending on user tools.
- Secret Service may be unavailable or locked on minimal environments.
- Notification behavior varies across desktop environments.

## Reference Links

- Electron global shortcuts: https://www.electronjs.org/docs/latest/api/global-shortcut/
- XDG Desktop Portal global shortcuts: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html
- Electron notifications: https://www.electronjs.org/docs/latest/tutorial/notifications
- AppImage desktop integration: https://docs.appimage.org/reference/desktop-integration.html
- FreeDesktop desktop entry keys: https://specifications.freedesktop.org/desktop-entry-spec/latest/recognized-keys.html
- electron-builder Linux targets: https://www.electron.build/linux
