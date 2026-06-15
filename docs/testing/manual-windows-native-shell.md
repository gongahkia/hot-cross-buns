# Manual Windows Native Shell Checklist

Use this checklist on a Windows 11 25H2 x64 machine before claiming a Windows
technical preview release.

## Build And Install

- Confirm `Windows Preview Validation` run `27525193372` or a newer run passed
  on the commit under test, or run `pnpm release:win:preview` on a Windows host.
- Verify `release/Hot-Cross-Buns-2-<version>-windows-x64.exe` exists.
- Verify `release/Hot-Cross-Buns-2-windows.exe` and
  `release/Hot-Cross-Buns-2-windows-x64.exe` aliases exist.
- Run `certutil -hashfile release\Hot-Cross-Buns-2-windows-x64.exe SHA256`
  and compare with `release\SHASUMS256.txt`.
- Run `pnpm release:smoke-nsis`.
- Run `HCB_PACKAGED_MCP_SMOKE=1 pnpm release:smoke-nsis-install` from a shell
  that supports environment assignment, or set `HCB_PACKAGED_MCP_SMOKE=1` before
  running `pnpm release:smoke-nsis-install`.
- Run `pnpm qa:evidence -- --target windows --dir release` and fill in
  `artifacts/manual-qa/windows-evidence.md` during the manual pass. The command
  exits nonzero if required local release files are missing. Successful Windows
  preview workflow artifacts also include this template. Fill `Target Host
  Details` with Windows 11 25H2, numeric OS build, x64 arch, tester, and
  concrete evidence attachments.
- Before uploading Windows release assets, run
  `pnpm qa:evidence:verify -- --target windows --stage pre-upload --verify artifacts/manual-qa/windows-evidence.md`.
- After Windows release assets exist and Settings update-check is verified, run
  `pnpm qa:evidence:verify -- --target windows --verify artifacts/manual-qa/windows-evidence.md`.
  Both verifier modes require concrete, non-placeholder notes summarizing the QA
  host and evidence attachments.
- If QA starts from a downloaded Windows preview workflow artifact, run
  `pnpm release:artifact-bundle -- --target windows --dir <downloaded-artifact-dir>`
  before copying the installer to the QA machine.
- Install with the NSIS installer.
- Record SmartScreen/Defender/browser warning text, if any, using
  [Windows Signing And SmartScreen](../release/windows-signing-smartscreen.md).
- Keep [Windows Preview Support](../support/windows-preview-support.md) open
  for install, checksum, and retained-data policy checks.

Record this host evidence before the manual pass:

```powershell
Get-Date -Format o
Get-ComputerInfo | Select-Object WindowsProductName, OsVersion, OsBuildNumber, OsArchitecture
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' | Select-Object ProductName, DisplayVersion, CurrentBuildNumber, UBR
node --version
pnpm --version
Get-FileHash .\release\Hot-Cross-Buns-2-windows-x64.exe -Algorithm SHA256
```

## Launch And Identity

- Launch from installer finish action.
- Launch from Start Menu.
- Launch from desktop shortcut if created.
- Confirm app icon appears in Start Menu, taskbar, and window titlebar.
- Confirm taskbar grouping uses one Hot Cross Buns 2 identity.
- Confirm Diagnostics reports platform `win32`, adapter
  `electron-windows-preview`, package format `nsis`, and AppUserModelID
  `dev.hotcrossbuns.hotcrossbuns2`.

## Credentials And OAuth

- Complete Google OAuth with the default browser.
- Confirm the localhost callback succeeds.
- Restart the app and confirm Google token refresh still works.
- Disconnect and reconnect the account.
- Confirm diagnostics/logs do not expose OAuth tokens or raw local paths.
- Confirm behavior if Windows safe storage is unavailable or locked.

## MCP

- Enable MCP.
- Confirm the listener binds only to `127.0.0.1`.
- Confirm unauthorized requests are rejected.
- Run the external HCB CLI smoke against the installed app.
- Reset the MCP token and confirm the old token is rejected.
- Confirm the runtime discovery file does not contain the bearer token.

## Tray And Window Behavior

- Confirm notification-area tray icon appears.
- Open tray menu and run show/hide, quick capture, refresh, settings, and quit.
- Confirm close/minimize behavior matches Settings copy.
- Confirm disabling the tray keeps the app usable from the main window.

## Global Shortcuts

- Configure global quick capture.
- Confirm the shortcut opens quick capture when the app is focused and
  unfocused.
- Try a conflicting shortcut and confirm Settings/Diagnostics show actionable
  recovery guidance.
- Quit the app and confirm the shortcut is unregistered.

## Notifications

- Confirm Windows notifications display for due tasks and upcoming events.
- Click a notification and confirm the expected app route opens.
- Disable notifications in Windows Settings and confirm the app reports a
  disabled or recoverable state.
- Confirm notification text is concise and does not include sensitive content.

## Deep Links

- Open `hotcrossbuns://today` while the app is running and confirm the existing
  instance routes it.
- Open `hotcrossbuns://today` while the app is closed and confirm launch argv
  routes it after startup.
- Test malformed links and confirm the app shows safe errors.
- Confirm links do not expose filesystem paths or tokens.

## Autostart

- Enable open-at-login.
- Restart Windows and confirm the app launches according to Settings copy.
- Disable open-at-login.
- Confirm uninstall removes installer-created startup entries.

## Update Check And Uninstall

- Run `pnpm release:asset-preflight -- --target windows --tag v<version>` after
  Windows artifacts are uploaded to a draft or published release.
- Confirm Settings check-for-updates finds Windows installer assets from GitHub
  Releases when a newer release exists.
- Confirm the app does not claim in-place auto-update.
- Uninstall through Windows Apps settings.
- Confirm uninstall behavior matches the retained user-data policy in
  [Windows Preview Support](../support/windows-preview-support.md).

## Performance

- Cold launch shell visible.
- Warm launch shell visible.
- Command palette opens.
- Quick capture opens.
- Local search against medium fixture.
- Task list scroll against large fixture.
- Calendar month navigation against large fixture.
- SQLite query-plan report is generated.

## Results

| Date | Build | Windows version | Tester | Result | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
