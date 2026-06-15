# Windows Preview Support

Hot Cross Buns 2 Windows support is a technical preview for Windows 11 x64.
The first preview artifact is an NSIS installer. Windows Preview Validation run
`27521460607` passed HCB CLI MCP smoke, packaging, installer artifact smoke,
checksum, silent install/launch/uninstall, Start Menu/desktop shortcut
target/removal checks, installed MCP smoke, persisted MCP token relaunch through
Windows safeStorage, Electron smoke, performance smoke with required launch
timing, and artifact upload on 2026-06-15 at commit `b415f1e`. Do not publish
Windows artifacts until the Windows 11 installed-app manual QA checklist passes.

## Install And Run

1. Download `Hot-Cross-Buns-2-<version>-windows-x64.exe`,
   `SHASUMS256.txt`, and the matching `.sha256` file from the release.
2. Verify checksums in PowerShell:

   ```powershell
   Get-FileHash .\Hot-Cross-Buns-2-<version>-windows-x64.exe -Algorithm SHA256
   ```

   Compare the hash with `SHASUMS256.txt`.

3. Run the installer.
4. Launch from the installer finish action, Start Menu, and desktop shortcut
   during QA.

Unsigned internal-preview installers can show Microsoft Defender SmartScreen,
browser, or unknown-publisher warnings. Do not disable SmartScreen or Defender
to make a preview install pass.

## Known Preview Limits

- Windows artifacts are internal technical previews until Windows 11 installed
  app QA passes.
- Public Windows distribution requires a code-signing and SmartScreen plan.
- In-place auto-update is not enabled. Settings checks GitHub Releases and
  opens a manual download path.
- Tray, global shortcut, notification, protocol, autostart, OAuth, MCP, and
  SQLite runtime behavior must be verified on Windows 11 before support claims
  expand beyond the technical preview.

## Diagnostics

Open Settings > Diagnostics and export a support bundle when reporting preview
issues. Diagnostics are designed to redact raw tokens, raw Google payloads,
bearer tokens, and local paths. Do not paste terminal or PowerShell output that
includes secrets.

Expected installed preview diagnostics:

- platform: `win32`
- adapter: `electron-windows-preview`
- package format: `nsis`
- AppUserModelID: `dev.hotcrossbuns.hotcrossbuns2`

## Data And Removal

Use Windows Settings > Apps > Installed apps > Hot Cross Buns 2 > Uninstall for
normal removal QA.

The NSIS uninstall path removes the installed application files. It is expected
to retain user data unless a future, explicitly documented clean-removal flow is
added and validated. Retained data can include local planner cache, settings,
diagnostics, logs, and safeStorage-backed encrypted credential metadata under
the app data paths shown in Diagnostics.

Before deleting retained data manually:

- export any local-only data you need to keep;
- confirm Google sync is healthy if synced tasks/events matter;
- disconnect accounts if you are testing credential cleanup;
- record the exact app data paths from Diagnostics.

Windows Preview Validation run `27521460607` verified that newly-created Start
Menu and desktop shortcuts target the installed executable and are absent after
silent uninstall. It also verified MCP bearer-token persistence across an
installed-app relaunch through Windows safeStorage. Manual Windows QA must still
confirm interactive uninstall behavior, retained data paths, protocol cleanup,
Google OAuth credential persistence, and open-at-login cleanup on Windows 11
before release notes claim the uninstall policy is verified.
