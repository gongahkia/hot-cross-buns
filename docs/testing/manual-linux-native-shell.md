# Manual Linux Native Shell Checklist

Use this checklist before publishing a Linux AppImage technical preview. It
records desktop-environment behavior that the automated Linux gates cannot prove
by themselves.

## Scope

Supported preview target:

- Ubuntu 26.04 LTS on GNOME.
- AppImage package.
- Fresh app data path via `HCB_ALLOW_PACKAGED_USER_DATA_DIR=1` and
  `HCB_USER_DATA_DIR=<absolute temp dir>` for at least one packaged-app pass.

Secondary checks:

- Fedora Workstation GNOME.
- KDE Plasma.
- One Wayland session.
- One X11 session.

Do not upgrade Linux copy from "technical preview" to general support unless the
primary target and the secondary session checks are recorded.

## Automated Evidence

Confirm the current release candidate already passed:

- `Linux AppImage Preview Validation` run `27525193156` or a newer run
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm release:review-bundle`
- `(cd release && sha256sum -c SHASUMS256.txt)`
- `pnpm release:smoke-appimage`
- `HCB_APPIMAGE_SMOKE_LAUNCH=1 pnpm release:smoke-appimage`
- `HCB_APPIMAGE_SMOKE_LAUNCH=1 HCB_PACKAGED_MCP_SMOKE=1 pnpm release:smoke-appimage`
  on a desktop session with Secret Service/keyring available
- `pnpm test:smoke`
- `pnpm test:perf`

Create the target-host evidence template before the manual pass:

```sh
pnpm qa:evidence -- --target linux --dir release
```

Attach `artifacts/manual-qa/linux-evidence.md` to the release notes draft after
the checklist is filled in. The command exits nonzero if required local release
files are missing. Successful Linux preview workflow artifacts also include this
template.

Before uploading Linux release assets, verify the completed pre-upload evidence.
The result must include non-empty notes summarizing the QA host and evidence
attachments:

```sh
pnpm qa:evidence:verify -- --target linux --stage pre-upload --verify artifacts/manual-qa/linux-evidence.md
```

After Linux release assets exist and Settings update-check is verified, run the
full evidence verifier:

```sh
pnpm qa:evidence:verify -- --target linux --verify artifacts/manual-qa/linux-evidence.md
```

If QA starts from a downloaded Linux preview workflow artifact, verify the
downloaded bundle first:

```sh
pnpm release:artifact-bundle -- --target linux --dir <downloaded-artifact-dir>
```

Record this host evidence before the manual pass:

```sh
date -Iseconds
uname -a
cat /etc/os-release
printf 'desktop=%s\nsession=%s\n' "${XDG_CURRENT_DESKTOP:-unset}" "${XDG_SESSION_TYPE:-unset}"
gnome-shell --version || true
sha256sum -c SHASUMS256.txt --ignore-missing
```

## AppImage Launch

- Verify the published AppImage checksum against `SHASUMS256.txt`.
- Confirm the host has the FUSE 2 compatibility package required for AppImages:
  `libfuse2t64` on Ubuntu 24.04 or newer, or `libfuse2` on Ubuntu 22.04.
- Run `chmod +x` on the AppImage.
- Launch from a terminal and record stdout/stderr.
- Launch from the file manager.
- Launch once with `HCB_ALLOW_PACKAGED_USER_DATA_DIR=1` and
  `HCB_USER_DATA_DIR` set to an empty absolute temporary directory.
- Keep the terminal-launch stdout/stderr log with the QA notes.
- Confirm the main window opens, closes, hides/shows, and quits cleanly.
- Confirm icon and taskbar/window grouping behavior.
- Open Settings and Diagnostics.
- Generate or copy a support bundle and confirm local paths and secrets are
  redacted.

## Credentials And OAuth

- Start with Secret Service ready, such as an unlocked GNOME Keyring or KWallet.
- Save a Desktop OAuth client ID and optional client secret.
- Complete the browser OAuth round trip.
- Quit and relaunch, then confirm token refresh and sync still work.
- Disconnect and reconnect the Google account.
- Repeat the startup check with Secret Service missing.
- Repeat the startup check with Secret Service locked before app launch.
- Confirm credential-dependent features fail recoverably when the provider is
  missing or locked.
- Inspect diagnostics and logs for raw OAuth tokens, client secrets, bearer
  tokens, Google payloads, and unredacted home-directory paths.

## MCP

- Enable the local MCP server.
- Confirm the listener binds to `127.0.0.1` only.
- Confirm the runtime discovery file is under the app config path.
- Confirm the runtime discovery file does not contain the raw bearer token.
- Run the CLI smoke path against the packaged AppImage.
- Reset the MCP bearer token and confirm the revision changes after relaunch.
- Confirm unauthorized, non-local, oversized, and browser-origin requests are
  rejected without leaking secrets.
- Disable MCP and confirm the listener stops.

## Notifications

- Confirm Diagnostics reports Linux notifications as unsupported in the
  technical preview.
- Confirm enabling notification settings does not schedule Linux desktop
  notifications.
- Confirm the unsupported notification state does not block startup, sync,
  tasks, calendar, notes, export, or diagnostics.
- For future validation builds only, test GNOME delivery, KDE delivery,
  click-through focus/action routing, disabled-setting clearing, and real
  delivery-failure diagnostics.

## Global Shortcuts

- Confirm Diagnostics reports Linux global shortcuts as unsupported in the
  technical preview.
- Confirm in-app quick add remains available from the command palette and normal
  app shortcuts.
- Confirm the unsupported shortcut state does not block startup, sync, tasks,
  calendar, notes, export, or diagnostics.
- For future validation builds only, test X11 registration, X11 conflict,
  Wayland portal registration, portal denial or missing portal support, and
  packaged AppImage quick-capture dispatch.

## Explicitly Unsupported Preview Features

The Linux technical preview intentionally does not support:

- tray/status-area surfaces
- Linux desktop notifications
- Linux global shortcuts
- `hotcrossbuns://` deep links
- open-at-login/autostart
- automatic in-place AppImage updates

For each unsupported feature:

- Confirm Settings and Diagnostics report the unsupported state.
- Confirm the main window remains the supported control surface.
- Confirm the unsupported feature does not block startup, sync, tasks, calendar,
  notes, export, or diagnostics.

## Updates

- Open the in-app update check.
- Run `pnpm release:asset-preflight -- --target linux --tag v<version>` after
  Linux artifacts are uploaded to a draft or published release.
- Confirm it points users to GitHub Releases.
- Confirm it prefers the AppImage asset when one exists.
- Confirm it does not download, replace, or install the AppImage automatically.

## Removal And Data Policy

- Delete the AppImage and confirm the app binary is removed.
- Confirm user data remains under the documented app data/config/cache paths.
- Remove the documented data directories only during an explicit clean-removal
  check.
- Confirm Google remains the source of truth for synced tasks and events.

## Results

| Date | Build | Distro | Desktop | Session | Tester | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |
