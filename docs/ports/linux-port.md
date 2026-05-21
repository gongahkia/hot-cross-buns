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

Start with AppImage because it is portable and maps well to preview distribution. Add DEB/RPM only after the core Linux app is useful.

Recommended order:

1. AppImage technical preview.
2. DEB for Debian/Ubuntu users.
3. RPM for Fedora/openSUSE users.
4. Flatpak only if sandboxing and portal behavior become a deliberate product goal.

AppImage desktop integration depends on `.desktop` metadata. AppImages carry a desktop file in the AppDir, and desktop files follow the FreeDesktop Desktop Entry Specification.

Desktop metadata must include:

- app name: Hot Cross Buns 2
- generic name: Planner
- categories appropriate for productivity/office
- icon metadata
- custom protocol handling if supported by the package
- `StartupWMClass` when needed for window/taskbar association

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

Preferred credential strategy:

- Use a maintained keychain abstraction that supports Secret Service/libsecret on Linux.
- Detect missing or locked secret service at runtime.
- Provide clear setup guidance when credentials cannot be saved.
- Never fall back to plaintext token storage without explicit user opt-in and a separate security decision.

Linux preview must test:

- secret service available and unlocked
- secret service missing
- secret service locked
- token reset
- app restart after token storage

## Tray / Status Area

Linux tray support varies. The platform adapter must expose tray capability and diagnostics rather than assuming the tray exists.

Required behavior:

- If tray registration succeeds, support show/hide, quick capture, refresh, settings, quit.
- If tray registration fails or the desktop environment hides status icons, keep the main app usable.
- Settings must show tray status and a diagnostic reason where available.

Manual QA must cover GNOME and KDE separately.

## Global Shortcuts

Linux global shortcuts are the highest-risk native feature.

Rules:

- On Wayland, prefer the XDG Desktop Portal global shortcuts path where Electron/Chromium support is available.
- On X11, test Electron `globalShortcut` directly.
- If registration fails, show an actionable settings error and keep quick capture available in-app.
- Do not claim global hotkeys are reliable on all Linux desktops.

Electron documents a `GlobalShortcutsPortal` feature flag for Wayland sessions. XDG Desktop Portal global shortcuts are session-bound and user-mediated, so the UI must tolerate user denial or missing portal support.

## Notifications

Electron sends Linux notifications through `libnotify` on desktop environments following the Desktop Notifications Specification. The adapter must check support and expose failures as diagnostics.

Required behavior:

- notification scheduling can be enabled only when notification support is detected
- failure to show a notification must not break sync or task/event data
- notification content should remain concise and privacy-conscious

## Custom Protocols And Deep Links

The Linux port must support `hotcrossbuns://` links only after package metadata and desktop registration are verified.

Required checks:

- protocol opens the installed app
- deep link routes to task/event/note where local data exists
- malformed links show a safe error
- protocol handling does not expose raw filesystem paths or tokens

## Autostart

Open-at-login should be treated as optional for Linux preview. Implement only through a platform adapter and document desktop-environment limitations.

Do not block the Linux preview on autostart.

## Updater Strategy

Use check-for-new-version first. Do not promise seamless in-place auto-update in Linux preview.

Electron's built-in `autoUpdater` does not support Linux. electron-builder's `electron-updater` supports Linux targets such as AppImage, DEB, Pacman, and RPM, but the product should still respect distro package manager expectations and package-specific behavior before enabling automatic updates.

## OAuth, MCP, And Networking

Required Linux checks:

- default browser opens Google OAuth consent
- localhost loopback callback succeeds
- firewall/security tools do not block normal callback path on supported distros
- MCP binds only to `127.0.0.1`
- MCP rejects non-local/unauthorized requests
- no tokens appear in logs, diagnostics, or renderer state

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
- tray behavior on GNOME
- tray behavior on KDE
- global shortcut on X11
- global shortcut on Wayland, if portal support is available
- notification support detected
- OAuth browser round trip
- MCP localhost smoke test
- custom protocol smoke test
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

