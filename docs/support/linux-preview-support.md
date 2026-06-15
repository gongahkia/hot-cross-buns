# Linux Preview Support

Hot Cross Buns 2 Linux support is a technical preview for Ubuntu LTS on GNOME.
The first preview artifact is an AppImage. Other distributions and desktop
environments are secondary validation targets until the Linux QA matrix is
complete.

Linux AppImage Preview Validation run `27499256281` passed HCB CLI MCP smoke,
AppImage packaging/checksum/metadata/launch smoke, packaged AppImage MCP smoke
under a hosted GNOME/libsecret keyring session, Electron smoke, performance
smoke, and artifact upload on 2026-06-14 at commit `df19162`. Ubuntu GNOME
manual QA remains required before uploading public Linux artifacts.

## Install And Run

1. Download `Hot-Cross-Buns-2-<version>-linux-x86_64.AppImage`,
   `SHASUMS256.txt`, and the matching `.sha256` file from the release.
2. Verify checksums:

   ```sh
   sha256sum -c SHASUMS256.txt
   ```

3. Make the AppImage executable:

   ```sh
   chmod +x Hot-Cross-Buns-2-<version>-linux-x86_64.AppImage
   ```

4. Launch it:

   ```sh
   ./Hot-Cross-Buns-2-<version>-linux-x86_64.AppImage
   ```

Use a terminal launch for first-run support reports so startup errors are
visible.

Ubuntu hosts must have a FUSE 2 compatibility package installed to run
AppImages. On Ubuntu 24.04 or newer use `libfuse2t64`; on Ubuntu 22.04 use
`libfuse2`.
Install it alongside the existing FUSE setup.

## Known Preview Limits

- AppImage is the only Linux package format.
- GitHub release checks can report newer Linux AppImage releases, but in-place
  automatic Linux updates are not enabled.
- `hotcrossbuns://` deep links are explicitly unsupported for Linux until
  installed AppImage desktop integration is validated.
- Tray/status area and open-at-login are explicitly unsupported until their
  dedicated Linux validation phases are complete.
- Global shortcuts are explicitly unsupported in the Linux technical preview.
  Future validation builds can test X11 Electron registration and Wayland XDG
  Desktop Portal GlobalShortcuts support, but the public preview keeps in-app
  quick add as the supported capture path.
- Local notifications are explicitly unsupported in the Linux technical preview.
  Future validation builds can test GNOME/KDE delivery and notification
  click-through, but the public preview does not schedule Linux desktop
  notifications.
- Credential storage requires an OS-backed Electron `safeStorage` provider such
  as GNOME Keyring/libsecret or KWallet. The app refuses Electron's
  `basic_text` plaintext fallback.
- Google OAuth and local MCP use loopback-only listeners. OAuth and external MCP
  CLI smoke still require Ubuntu GNOME ready/missing/locked Secret Service
  validation before public preview claims expand beyond the technical preview.

## Diagnostics

Open Settings > Diagnostics and export a support bundle when reporting preview
issues. Diagnostics are designed to redact raw tokens, raw Google payloads,
bearer tokens, Linux home paths, and other local paths. Do not paste terminal
output that includes secrets.

Useful checks for support reports:

```sh
echo "$XDG_SESSION_TYPE"
echo "$XDG_CURRENT_DESKTOP"
./Hot-Cross-Buns-2-<version>-linux-x86_64.AppImage --appimage-extract
```

The extracted `squashfs-root/*.desktop` file should identify the app as
`Hot Cross Buns 2`, category `Office`, and `StartupWMClass=hot-cross-buns-2`.

## Data And Removal

The AppImage is portable. Removing the AppImage file removes the application
binary, but it does not remove user data.

Electron stores app data using the platform app paths exposed in Diagnostics.
For a clean smoke run, launch with an isolated user data directory:

```sh
HCB_ALLOW_PACKAGED_USER_DATA_DIR=1 HCB_USER_DATA_DIR="$(mktemp -d)" ./Hot-Cross-Buns-2-<version>-linux-x86_64.AppImage
```

Before deleting data directories, export any local data you need to keep and
confirm Google sync is healthy.
