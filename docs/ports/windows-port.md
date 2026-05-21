# Windows Port

Windows is the second non-Mac port, after the Linux technical preview. Treat it as its own platform with installer, identity, notification, signing, and SmartScreen requirements.

## Target Scope

Initial supported target:

- Windows 11 current stable release at implementation time.

Secondary manual-check target:

- Windows 10 if Electron/runtime support and user demand justify it.

Do not claim Windows support until launch, OAuth, SQLite, MCP, tray, notifications, protocol registration, packaging, and uninstall behavior have been tested on a real Windows machine or CI runner with appropriate manual checks.

## Package Targets

Recommended order:

1. NSIS installer technical preview.
2. Portable zip/exe only for developer testing.
3. MSIX or Microsoft Store path as a later product/distribution decision.
4. MSI only if enterprise deployment becomes a real requirement.

electron-builder supports Windows targets including NSIS, portable, AppX, MSI, and Squirrel.Windows. Start with NSIS because it is a common desktop installer path and is also an auto-updatable target when using electron-updater.

## App Identity

Windows needs a stable application identity for notifications, taskbar grouping, shortcuts, jump lists, protocol handling, and installer behavior.

Required decisions:

- stable app id
- executable name
- installer display name
- publisher name once signing is available
- AppUserModelID
- Start Menu shortcut name
- protocol registration name

The app must set its Windows AppUserModelID early in startup before showing UI or using notifications.

## Code Signing And SmartScreen

Unsigned Windows installers are not suitable for public distribution.

Microsoft's current guidance:

- Microsoft Store MSIX submissions are re-signed by Microsoft.
- MSI/EXE installers distributed outside the Store need Authenticode signing for public trust.
- Self-signed certificates are for development/testing or managed enterprise trust only.
- New signed apps may still build SmartScreen reputation over time.

Windows preview can start unsigned only for local/internal testing, with explicit documentation. Public Windows distribution requires a signing plan.

Signing options to evaluate:

- Microsoft Store MSIX path
- Azure Artifact Signing / Trusted Signing where available
- OV certificate from a public CA
- SignPath Foundation if project eligibility applies

## Windows Paths

Use the platform adapter for:

- roaming/local app data
- cache
- logs
- diagnostics artifacts
- temporary databases
- installer/uninstaller state

Do not hardcode POSIX paths or assume case-sensitive filesystem behavior.

## Credential Storage

Preferred credential strategy:

- Use a maintained keychain abstraction backed by Windows Credential Manager or equivalent secure storage.
- Test token save/load/delete across restart.
- Test behavior when credential storage fails.
- Do not fall back to plaintext token storage without a separate explicit security decision.

## Tray And Taskbar

Windows tray behavior is notification-area behavior, not macOS menu bar behavior.

Required behavior:

- tray icon opens menu with show/hide, quick capture, refresh, settings, quit
- double-click or primary activation behavior is documented
- app remains usable if tray is unavailable or disabled
- taskbar grouping uses stable app identity
- app window restore behavior is tested after minimize/close-to-tray decisions

Close/minimize semantics must be explicit. Do not surprise users by keeping the app running in tray unless settings explain that behavior.

## Global Shortcuts

Required behavior:

- register configurable global quick capture shortcut
- detect registration failure
- show conflict/recovery guidance in Settings
- unregister shortcuts on quit
- keep in-app quick capture available even if global shortcut fails

Windows agents must test common conflicts with OS and browser shortcuts.

## Notifications

Windows notification behavior depends on app identity and OS notification settings.

Required behavior:

- set AppUserModelID early
- query or infer notification availability where possible
- show Settings diagnostics when notifications are disabled or silently discarded
- keep notification content concise and privacy-conscious

Advanced notification actions are out of scope for the first Windows preview unless a later spec adds them.

## Custom Protocols And Deep Links

Required behavior:

- installer registers `hotcrossbuns://`
- app handles cold-start and warm-start links
- malformed links show safe errors
- deep link routing never exposes tokens or raw file paths
- uninstall behavior for protocol registration is documented

## Autostart

Open-at-login is optional for Windows preview. Implement only through the platform adapter and verify:

- enable
- disable
- app update preserves user choice
- uninstall removes installer-created autostart entries if applicable

## Updater Strategy

Use check-for-new-version first for technical preview.

Electron's built-in `autoUpdater` supports Windows depending on package format. electron-builder's `electron-updater` supports NSIS as an auto-updatable target. Do not enable in-place auto-update until installer identity, code signing, release metadata, and rollback behavior are tested.

## OAuth, MCP, Firewall

Required Windows checks:

- default browser opens Google OAuth consent
- localhost loopback callback succeeds
- firewall/security prompts are understood and documented if they appear
- MCP binds only to `127.0.0.1`
- MCP rejects unauthorized requests
- Windows Defender/SmartScreen behavior is documented for unsigned preview artifacts

## Performance Checks

Required Windows performance checks:

- cold launch shell visible
- warm launch shell visible
- command palette open
- quick capture open
- local search against medium fixture
- task list scroll against large fixture
- calendar month navigation against large fixture
- SQLite query-plan report
- installer launch after fresh install

## Windows Manual QA Checklist

Before Windows technical preview:

- install with NSIS
- launch from installer finish action
- launch from Start Menu
- launch from desktop shortcut if created
- app icon appears correctly
- taskbar grouping is correct
- tray icon and menu work
- global shortcut registration succeeds or reports conflict
- notification support works or reports disabled state
- OAuth browser round trip
- MCP localhost smoke test
- custom protocol cold-start and warm-start links
- update check UI does not claim unsupported auto-update
- uninstall behavior is documented and tested

## Known Risks

- Public unsigned builds will hit strong Windows trust warnings.
- SmartScreen reputation may take time even after signing.
- Notification behavior can fail silently without correct app identity.
- Antivirus tooling can interfere with installers, auto-update, or local server behavior.
- Native modules must be built or prebuilt for Windows.

## Reference Links

- Microsoft Windows code signing options: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Windows AppUserModelID guidance: https://learn.microsoft.com/en-us/windows/win32/shell/appids
- Electron notifications: https://www.electronjs.org/docs/latest/tutorial/notifications
- Electron autoUpdater: https://www.electronjs.org/docs/latest/api/auto-updater
- electron-builder targets: https://www.electron.build/docs/
- electron-builder auto-update: https://www.electron.build/docs/features/auto-update/

