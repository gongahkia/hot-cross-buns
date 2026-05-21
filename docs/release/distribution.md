# Distribution

## Release Strategy

Hot Cross Buns 2 starts with preview desktop builds. macOS is first, Linux is the first non-Mac technical preview, and Windows follows Linux.

Preview releases may be unsigned initially, but the docs and build pipeline must leave a clear path to signing, notarization, and updater support.

## macOS Preview

Initial macOS targets:

- zip or DMG artifact
- checksum file
- GitHub Releases upload
- release notes

If unsigned:

- release notes must state that macOS may warn on first launch
- install docs must explain the preview trust flow
- app UI must not claim seamless auto-update

## macOS Signing And Notarization

Before broad distribution:

- sign the app with Developer ID Application certificate
- notarize release artifacts
- staple where applicable
- verify Gatekeeper behavior on a clean machine

Auto-update on macOS should not be enabled until signing/notarization and release metadata are reliable.

## Updater Strategy

V1 preview updater may be a check-for-new-version flow:

- query GitHub Releases
- compare semantic version
- show release notes
- open download page or artifact URL

In-place auto-update can be added later through Electron updater tooling once signing is in place.

## Linux Future

Required before Linux preview:

- AppImage target first unless another package is explicitly chosen
- desktop file metadata
- icon and `StartupWMClass` behavior
- protocol registration behavior
- updater stance by package format
- distro and desktop-environment support matrix
- tray/global shortcut caveats documented

Linux preview should use check-for-new-version before in-place updates. Electron's built-in `autoUpdater` does not support Linux; package-manager and electron-builder updater behavior must be evaluated per package target before claiming automatic updates.

See [Linux Port](../ports/linux-port.md).

## Windows Future

Required before Windows preview:

- NSIS installer target first unless another package is explicitly chosen
- code signing plan
- AppUserModelID and installer identity
- protocol registration
- update metadata strategy
- SmartScreen expectations documented
- Start Menu, shortcut, tray, and notification behavior tested

Windows preview may be unsigned only for local/internal testing. Public Windows distribution requires an explicit signing and SmartScreen plan.

See [Windows Port](../ports/windows-port.md).

## Versioning

Use semantic versions:

- patch for fixes
- minor for feature additions
- major for migration or compatibility breaks

Build metadata may include commit SHA in diagnostics but must not be required for user-facing version comparisons.

## Release Checklist

Each release must include:

- passing automated test suite
- Playwright launch smoke test
- migration test pass
- release notes
- artifact checksum
- install instructions
- known issues
- manual platform checks for native behavior changed in the release

## Rollback

Release docs must include rollback guidance:

- where local app data lives
- how to preserve local SQLite before downgrade
- when downgrade is unsupported after migrations
- how to clear local cache and resync from Google
