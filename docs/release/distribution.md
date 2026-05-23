# Distribution

## Release Strategy

Hot Cross Buns 2 starts with preview desktop builds. macOS is first, Linux is the first non-Mac technical preview, and Windows follows Linux.

Preview releases may be unsigned initially, but the docs and build pipeline must leave a clear path to signing, notarization, and updater support.

The current packaging tool is `electron-builder`, matching the cross-platform porting strategy.

## macOS Preview

Initial macOS targets:

- DMG artifact
- zip artifact
- `SHA256` checksum file
- stable latest aliases for the newest local DMG/zip
- per-artifact `.sha256` files
- GitHub Releases upload
- release notes

The current macOS preview build is intentionally unsigned:

- `electron-builder.yml` sets `mac.identity: null`.
- `electron-builder.yml` sets `dmg.sign: false`.
- Release scripts run with `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- No signing certificates, Apple account credentials, or notarization secrets are stored in the repository.
- Auto-update is not enabled.

Current package metadata:

| Field | Value |
|---|---|
| Package name | `hot-cross-buns-2` |
| Product name | `Hot Cross Buns 2` |
| Version source | `package.json` `version` |
| Author metadata | `gongahkia` |
| macOS bundle id | `dev.hotcrossbuns.hotcrossbuns2` |
| Artifact pattern | `Hot-Cross-Buns-2-${version}-${os}-${arch}.${ext}` |
| macOS category | `public.app-category.productivity` |
| Dock/app icon | `build/icon.icns` generated from `assets/brand/app-icon.png` |
| Renderer sidebar icon | `assets/brand/buns-app-icon-sidebar.png` |
| Menu bar template icon | `assets/brand/menubar-template.png` and `assets/brand/menubar-template@2x.png` |
| Extra packaged resources | `assets/brand` copied into `Contents/Resources/assets/brand` |
| Update behavior | none wired in app runtime |

## Local Release Commands

Run the full macOS preview release gate:

```sh
pnpm release:mac:preview
```

That command runs:

```sh
pnpm test
pnpm build:release:mac
pnpm release:review-bundle
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --publish never
pnpm release:mac-artifacts
pnpm release:checksums
```

For a packaging-only preview after local validation:

```sh
pnpm pack:mac:preview
```

To run the steps manually:

```sh
pnpm test
pnpm build:release:mac
pnpm release:review-bundle
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --publish never
pnpm release:mac-artifacts
pnpm release:checksums
```

Expected artifact paths:

```text
release/Hot-Cross-Buns-2-<version>-mac-<arch>.dmg
release/Hot-Cross-Buns-2-<version>-mac-<arch>.zip
release/Hot-Cross-Buns-2-macOS.dmg
release/Hot-Cross-Buns-2-macOS.zip
release/Hot-Cross-Buns-2-macOS-<arch>.dmg
release/Hot-Cross-Buns-2-macOS-<arch>.zip
release/SHASUMS256.txt
release/*.sha256
artifacts/release/bundle-review.json
artifacts/release/bundle-review.md
```

`electron-builder` may also leave `.blockmap`, `builder-debug.yml`, and `latest-mac.yml` files in `release/`. Do not upload those files for unsigned preview releases. They are not supported updater artifacts for the current release flow.

The packaged `.app` may contain electron-builder's generated `Contents/Resources/app-update.yml`. In the current app this is packaging metadata only; no in-app updater is wired, and release notes must not claim automatic updates.

Verify checksums locally:

```sh
cd release
shasum -a 256 -c SHASUMS256.txt
cd -
```

Optional install helper after downloading or building both an artifact and `SHASUMS256.txt`:

```sh
scripts/install-mac-preview.sh release/Hot-Cross-Buns-2-0.0.0-mac-arm64.dmg release/SHASUMS256.txt
```

The helper verifies the artifact checksum before copying the contained `.app` bundle. It does not sign, notarize, bypass Gatekeeper, or enable updates.

Optional DMG bundle smoke after packaging:

```sh
pnpm release:smoke-dmg
```

The smoke script mounts the DMG read-only and verifies the `.app` bundle, executable, and bundle id. It is not a substitute for signed/notarized Gatekeeper QA.

## Version Metadata

`pnpm build:release:mac` injects build metadata into the compiled main process:

- `HCB_BUILD_COMMIT`: short Git commit, derived from `git rev-parse --short=12 HEAD`
- `HCB_BUILD_DATE`: UTC ISO timestamp from the release build
- `HCB_PACKAGE_TOOL`: `electron-builder`

The app exposes this metadata through diagnostics health and diagnostics summary responses. Build metadata is informational only; semantic version comparisons should use `package.json` version.

## Bundle And Dependency Review

Run:

```sh
pnpm release:review-bundle
```

The review checks:

- built main, preload, and renderer outputs exist
- renderer source does not import Electron, Node built-ins, main modules, or preload modules
- preload source does not import main-process modules
- build/test tools are not listed as runtime dependencies
- renderer/main/preload output sizes and largest renderer assets

The command writes:

```text
artifacts/release/bundle-review.json
artifacts/release/bundle-review.md
```

Generated review artifacts are local release evidence and should not be committed unless a release PR explicitly asks for them.

## GitHub Release Draft

Prepare release notes:

```sh
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
mkdir -p docs/release/notes
$EDITOR "docs/release/notes/${TAG}.md"
```

Create a draft GitHub Release after `pnpm release:mac:preview` passes:

```sh
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
gh release create "$TAG" \
  release/Hot-Cross-Buns-2-${VERSION}-mac-*.dmg \
  release/Hot-Cross-Buns-2-${VERSION}-mac-*.zip \
  release/Hot-Cross-Buns-2-macOS*.dmg \
  release/Hot-Cross-Buns-2-macOS*.zip \
  release/*.sha256 \
  release/SHASUMS256.txt \
  --draft \
  --title "Hot Cross Buns 2 ${VERSION}" \
  --notes-file "docs/release/notes/${TAG}.md"
```

The GitHub Release notes must include:

- unsigned preview warning
- install steps
- checksum verification command
- known issues
- manual macOS checks performed
- signing/notarization status

Do not publish the draft until the uploaded artifact names and checksums match `release/SHASUMS256.txt`.

## Unsigned Preview Install Notes

Unsigned preview builds are for internal or early technical preview use.

DMG install:

1. Download the `.dmg` and `SHASUMS256.txt` from the GitHub Release.
2. Verify the checksum with `shasum -a 256 -c SHASUMS256.txt`.
3. Open the DMG and drag `Hot Cross Buns 2.app` to `/Applications`.
4. On first launch, macOS may warn that the app is from an unidentified developer.
5. Use Finder to Control-click or right-click `Hot Cross Buns 2.app`, choose `Open`, then confirm `Open`.

Zip install:

1. Download the `.zip` and `SHASUMS256.txt` from the GitHub Release.
2. Verify the checksum with `shasum -a 256 -c SHASUMS256.txt`.
3. Unzip the archive and move `Hot Cross Buns 2.app` to `/Applications`.
4. Use the same first-launch `Open` flow if macOS blocks the app.

Do not tell users to disable Gatekeeper. If the `Open` option is unavailable, use `System Settings > Privacy & Security` and choose `Open Anyway` for `Hot Cross Buns 2`.

For support-ready preview guidance, including diagnostics, privacy summary, and reinstall/rollback notes, see [Mac Preview Support](../support/mac-preview-support.md).

## macOS Signing And Notarization

Before broad distribution:

- sign the app with a Developer ID Application certificate
- enable hardened runtime
- add only the entitlements the app actually needs
- notarize release artifacts
- staple where applicable
- verify Gatekeeper behavior on a clean machine

Future signing placeholders:

- CI keychain import for the Developer ID certificate must come from external secrets.
- Apple notarization credentials must come from external secrets, for example App Store Connect API key material or app-specific password credentials.
- `electron-builder` signing identity, hardened runtime, entitlements, and notarization hooks should be added only when those secrets and manual validation exist.

None of these placeholders are currently enabled.

## Updater Strategy

V1 preview updater may be a check-for-new-version flow:

- query GitHub Releases
- compare semantic version
- show release notes
- open download page or artifact URL

In-place auto-update can be added later through Electron updater tooling once signing, notarization, release metadata, and rollback behavior are reliable. Do not claim seamless auto-update until a signed updater flow is configured and tested.

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
- bundle/dependency review pass
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
