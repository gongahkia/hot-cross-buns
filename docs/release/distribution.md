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
- Release scripts run with `CSC_IDENTITY_AUTO_DISCOVERY=false` through
  `scripts/electron-builder-preview.ts`.
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
tsx scripts/electron-builder-preview.ts --mac --publish never
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
tsx scripts/electron-builder-preview.ts --mac --publish never
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

## Linux AppImage Technical Preview

Initial Linux target:

- AppImage artifact only
- `SHA256` checksum file
- stable latest alias for the newest local AppImage
- per-artifact `.sha256` file
- GitHub Releases upload after Linux release gates pass
- support page with known limitations and diagnostics guidance

The Linux preview is intentionally narrower than the macOS preview:

- AppImage is the only package format in this phase.
- In-place Linux auto-update is not enabled.
- `hotcrossbuns://` protocol metadata is not registered for Linux until deep-link validation is complete.
- Tray and autostart remain disabled unless their later phases validate them.
- Notifications and global shortcuts are explicitly unsupported in this Linux technical preview until the Linux manual QA matrix validates them in future builds.
- Credential storage requires Electron `safeStorage` with an OS-backed Linux provider such as GNOME Keyring/libsecret or KWallet; Electron `basic_text` plaintext fallback is rejected.

Linux package metadata:

| Field | Value |
|---|---|
| Product name | `Hot Cross Buns 2` |
| Artifact pattern | `Hot-Cross-Buns-2-${version}-linux-${arch}.AppImage`; electron-builder emits `x86_64` for x64 AppImages |
| Linux category | `Office` |
| Executable name | `hot-cross-buns-2` |
| Generic name | `Planner` |
| Keywords | `tasks;calendar;notes;planner;productivity;` |
| StartupWMClass | `hot-cross-buns-2` |
| Linux icons | `build/icons/<size>x<size>.png` generated from `assets/brand/app-icon.png` |
| Protocol metadata | omitted until Linux deep links are validated |

Run the full Linux preview release gate on a Linux host or Linux CI runner:

```sh
pnpm release:linux:preview
```

The manual GitHub Actions gate is `.github/workflows/linux-preview.yml`. Run
`Linux AppImage Preview Validation` from GitHub Actions after the workflow file
is on a branch GitHub can see. The workflow builds the AppImage, verifies
checksums, runs AppImage metadata and launch smoke under Xvfb, runs the HCB CLI
MCP loopback smoke, runs packaged AppImage MCP smoke under a DBus
GNOME/libsecret keyring session, runs Electron smoke, runs performance smoke,
and uploads preview artifacts for review. It does not replace Ubuntu 26.04 LTS GNOME
desktop manual QA. The workflow installs the Ubuntu FUSE 2 compatibility package
needed for AppImage launch smoke. The AppImage launch smoke passes
`--no-sandbox` through an explicit CI-only environment gate because the hosted
runner cannot set the extracted AppImage `chrome-sandbox` helper to root-owned
mode `4755`; do not treat that CI flag as user install guidance. Run
`27525193156` passed this gate on 2026-06-15 at commit `dd2f607` with required
Electron launch timing, manual QA evidence-template generation, and
current-template preview artifact bundle verification.

After downloading a Linux preview workflow artifact for target-host QA, verify
the bundle before copying it to the QA machine:

```sh
RUN_ID=<linux-preview-run-id>
rm -rf "artifacts/qa/linux-preview-${RUN_ID}"
gh run download "$RUN_ID" \
  --name "linux-preview-artifacts-${RUN_ID}" \
  --dir "artifacts/qa/linux-preview-${RUN_ID}"
pnpm release:artifact-bundle -- --target linux --dir "artifacts/qa/linux-preview-${RUN_ID}"
```

That command runs:

```sh
pnpm test
pnpm build:release:linux
pnpm release:review-bundle
pnpm exec electron-builder --linux AppImage --publish never
pnpm release:linux-artifacts
pnpm release:checksums
```

For a packaging-only preview after local validation:

```sh
pnpm pack:linux:preview
```

Expected artifact paths:

```text
release/Hot-Cross-Buns-2-<version>-linux-x86_64.AppImage
release/Hot-Cross-Buns-2-linux.AppImage
release/Hot-Cross-Buns-2-linux-x64.AppImage
release/SHASUMS256.txt
release/*.sha256
artifacts/release/bundle-review.json
artifacts/release/bundle-review.md
```

The alias helper only accepts versioned `Hot-Cross-Buns-2-*-linux-*.AppImage`
artifact names, so unrelated AppImage files in `release/` are ignored.

Run the AppImage artifact smoke after packaging:

```sh
pnpm release:smoke-appimage
```

The smoke script verifies that the versioned Linux AppImage, stable Linux alias,
stable Linux x64 alias, checksum manifest, and per-artifact `.sha256` sidecars
agree. It also verifies that the AppImage is executable, can be extracted with
`--appimage-extract`, contains expected desktop metadata, and does not register
`hotcrossbuns://`. The checksum manifest must contain only top-level uploaded
release artifacts; nested extracted or unpacked helper paths fail the smoke.
To also launch the AppImage with the gated packaged
`HCB_USER_DATA_DIR` override and require startup logs, run:

```sh
HCB_APPIMAGE_SMOKE_LAUNCH=1 pnpm release:smoke-appimage
```

On a Linux desktop with a verified Secret Service/keyring session, add
`HCB_PACKAGED_MCP_SMOKE=1` to make the launch smoke enable read-only MCP on a
random loopback port, reject an unauthorized request, and run `hcb doctor`
through CLI runtime discovery with a seeded smoke token:

```sh
HCB_APPIMAGE_SMOKE_LAUNCH=1 HCB_PACKAGED_MCP_SMOKE=1 pnpm release:smoke-appimage
```

Verify checksums locally:

```sh
cd release
sha256sum -c SHASUMS256.txt
cd -
```

Linux preview support and run instructions live in [Linux Preview Support](../support/linux-preview-support.md).

## Windows Technical Preview

Run the full Windows technical preview release gate on a Windows host or
Windows CI runner:

```sh
pnpm release:win:preview
```

The manual GitHub Actions gate is `.github/workflows/windows-preview.yml`. It
pins `windows-2022` so Node 20 native-module installs use the Visual Studio 2022
toolchain instead of the Windows Server 2025 / Visual Studio 2026 image currently
behind `windows-latest`. The workflow also runs the HCB CLI MCP loopback smoke
before packaging and sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so GitHub's
JavaScript actions use the upcoming Node 24 action runtime while the project
still builds/tests with Node 20. Run `27525193372` passed this gate on
2026-06-15 at commit `dd2f607`, including silent NSIS install/launch/uninstall,
Start Menu/desktop shortcut target/removal checks, installed MCP smoke,
persisted MCP token relaunch through Windows safeStorage, required Electron
launch timing, manual QA evidence-template generation, and current-template
preview artifact bundle verification.

After downloading a Windows preview workflow artifact for target-host QA, verify
the bundle before copying it to the QA machine:

```sh
RUN_ID=<windows-preview-run-id>
rm -rf "artifacts/qa/windows-preview-${RUN_ID}"
gh run download "$RUN_ID" \
  --name "windows-preview-artifacts-${RUN_ID}" \
  --dir "artifacts/qa/windows-preview-${RUN_ID}"
pnpm release:artifact-bundle -- --target windows --dir "artifacts/qa/windows-preview-${RUN_ID}"
```

Linux cross-packaging for the Windows NSIS target requires Wine. A Linux host
without Wine can still complete the release build and `win-unpacked` step, but
electron-builder will stop before NSIS installer creation.

That command runs:

```sh
pnpm test
pnpm build:release:win
pnpm release:review-bundle
tsx scripts/electron-builder-preview.ts --win nsis --x64 --publish never
pnpm release:win-artifacts
pnpm release:checksums
```

For a packaging-only preview after local validation:

```sh
pnpm pack:win:preview
```

Expected artifact paths:

```text
release/Hot-Cross-Buns-2-<version>-windows-x64.exe
release/Hot-Cross-Buns-2-windows.exe
release/Hot-Cross-Buns-2-windows-x64.exe
release/SHASUMS256.txt
release/*.sha256
artifacts/release/bundle-review.json
artifacts/release/bundle-review.md
```

The alias helper only accepts versioned `Hot-Cross-Buns-2-*-windows-*.exe`
artifact names, so unrelated `.exe` files in `release/` are ignored.

Run the Windows installer artifact smoke after packaging:

```sh
pnpm release:smoke-nsis
```

The smoke script verifies that the versioned Windows x64 installer, stable
Windows alias, stable Windows x64 alias, checksum manifest, and per-artifact
`.sha256` sidecars agree. The checksum manifest must contain only top-level
uploaded release artifacts; nested `win-unpacked` helper paths fail the smoke.
It does not replace the installed-app manual checks in
[Manual Windows Native Shell Checklist](../testing/manual-windows-native-shell.md).

On Windows, run the silent install smoke before manual QA:

```powershell
pnpm release:smoke-nsis-install
```

The install smoke silently installs the stable x64 installer alias to an
isolated temporary directory, launches `Hot Cross Buns 2.exe` with isolated user
data, verifies Start Menu and desktop shortcuts target the installed executable,
kills the process tree, runs the NSIS uninstaller silently, and verifies the
installed app executable plus newly-created shortcuts were removed. It does not
replace manual Start Menu/desktop launch, protocol, notification, SmartScreen,
or retained-data checks.
Set `HCB_PACKAGED_MCP_SMOKE=1` for the installed-app MCP variant; it enables
read-only MCP on a random loopback port, verifies unauthorized requests return
`401`, and runs `hcb doctor` through CLI runtime discovery with a seeded smoke
token.
The Windows Preview Validation workflow runs the silent install smoke with this
flag enabled.

Windows preview support and uninstall/data-retention policy live in
[Windows Preview Support](../support/windows-preview-support.md).

Verify checksums locally on Windows:

```powershell
Get-FileHash .\release\Hot-Cross-Buns-2-windows-x64.exe -Algorithm SHA256
```

or from a shell with GNU coreutils:

```sh
cd release
sha256sum -c SHASUMS256.txt
cd -
```

## Version Metadata

`pnpm build:release:mac`, `pnpm build:release:linux`, and
`pnpm build:release:win` use `scripts/release-build.ts` to inject build
metadata into the compiled main process on macOS, Linux, and Windows:

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

Create a draft GitHub Release after the platform preview gates pass. For the
macOS preview artifacts:

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

Do not publish the draft until the uploaded artifact names and checksums match
`release/SHASUMS256.txt`. If one GitHub Release contains multiple platform
families, upload a unified `SHASUMS256.txt` generated from the full final
artifact set. Do not clobber an existing release checksum manifest with a
platform-only manifest.

For the Linux AppImage technical preview artifacts, either create a Linux-only
draft release or upload these files to the existing `v${VERSION}` draft after
the Ubuntu 26.04 LTS GNOME manual matrix, `pnpm release:linux:preview`, checksum
verification, and AppImage smoke pass. If any artifact, alias, release note, or
manual-QA fix changes after the preview build, regenerate `SHASUMS256.txt` and
the sidecar `.sha256` files before upload:

```sh
VERSION=$(node -p "require('./package.json').version")
pnpm release:upload-preflight -- --target linux \
  --release-dir release \
  --evidence artifacts/manual-qa/linux-evidence.md \
  --notes "docs/release/notes/v${VERSION}.md"
```

This preflight checks pre-upload manual QA evidence. The Settings update-check
item is verified after the draft or published release contains the Linux assets.

```sh
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
gh release upload "$TAG" \
  release/Hot-Cross-Buns-2-${VERSION}-linux-x86_64.AppImage \
  release/Hot-Cross-Buns-2-linux.AppImage \
  release/Hot-Cross-Buns-2-linux-x64.AppImage \
  release/Hot-Cross-Buns-2-${VERSION}-linux-x86_64.AppImage.sha256 \
  release/Hot-Cross-Buns-2-linux.AppImage.sha256 \
  release/Hot-Cross-Buns-2-linux-x64.AppImage.sha256 \
  release/SHASUMS256.txt \
  --clobber
```

After upload, verify that the release contains the required Linux upload files,
GitHub SHA-256 digest metadata with byte-matching stable aliases, and at least
one Linux x64 AppImage asset that Settings update-check can prefer:

```sh
pnpm release:asset-preflight -- --target linux --tag "$TAG"
```

The Linux release notes must clearly say AppImage technical preview, list the
unsupported Linux native features, and use `sha256sum -c SHASUMS256.txt` for
checksum verification.

For the Windows NSIS technical preview artifacts, either create a Windows-only
draft release or upload these files to the existing `v${VERSION}` draft after
`pnpm release:win:preview`, checksum verification, installer smoke, and manual
Windows installed-app QA pass. If any artifact, alias, release note, or
manual-QA fix changes after the preview build, regenerate `SHASUMS256.txt` and
the sidecar `.sha256` files before upload:

```sh
VERSION=$(node -p "require('./package.json').version")
pnpm release:upload-preflight -- --target windows \
  --release-dir release \
  --evidence artifacts/manual-qa/windows-evidence.md \
  --notes "docs/release/notes/v${VERSION}.md"
```

This preflight checks pre-upload manual QA evidence. The Settings update-check
item is verified after the draft or published release contains the Windows
assets.

```sh
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
gh release upload "$TAG" \
  release/Hot-Cross-Buns-2-${VERSION}-windows-x64.exe \
  release/Hot-Cross-Buns-2-windows.exe \
  release/Hot-Cross-Buns-2-windows-x64.exe \
  release/Hot-Cross-Buns-2-${VERSION}-windows-x64.exe.sha256 \
  release/Hot-Cross-Buns-2-windows.exe.sha256 \
  release/Hot-Cross-Buns-2-windows-x64.exe.sha256 \
  release/SHASUMS256.txt \
  --clobber
```

After upload, verify that the release contains the required Windows upload
files, GitHub SHA-256 digest metadata with byte-matching stable aliases, and at
least one Windows x64 `.exe` asset that Settings update-check can prefer:

```sh
pnpm release:asset-preflight -- --target windows --tag "$TAG"
```

The Windows release notes must clearly say unsigned NSIS technical preview
unless signing is enabled, list SmartScreen expectations, and use SHA-256
checksum verification.

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

## Linux Remaining Gates

Still required before publishing a Linux preview:

- distro and desktop-environment support matrix
- AppImage launch from terminal and file manager
- app icon and window grouping on the supported desktop matrix
- OAuth browser round trip on Ubuntu 26.04 LTS GNOME
- Secret Service ready, missing, and locked states
- live MCP CLI smoke against the packaged AppImage
- filled target-host evidence template from
  `pnpm qa:evidence -- --target linux --dir release`
- packaged preview confirmation that Linux notifications and global shortcuts
  remain explicitly unsupported
- Linux manual QA matrix from `TODO.md`

Linux preview uses check-for-new-version before in-place updates. The app's Linux release check reads GitHub Releases and prefers AppImage assets, but it does not download or install updates automatically. Electron's built-in `autoUpdater` does not support Linux; package-manager and electron-builder updater behavior must be evaluated per package target before claiming automatic updates.

See [Linux Port](../ports/linux-port.md).

## Windows Technical Preview Gates

Automated Windows preview gates passed on 2026-06-15:

- Windows CI run of `pnpm release:win:preview`
- Manual run of the `Windows Preview Validation` GitHub Actions workflow
- HCB CLI MCP loopback smoke with `pnpm hcb:smoke`
- NSIS installer smoke with `pnpm release:smoke-nsis`
- silent NSIS install/launch/uninstall plus installed MCP smoke with
  `HCB_PACKAGED_MCP_SMOKE=1 pnpm release:smoke-nsis-install`
- Start Menu/desktop shortcut target and removal checks inside
  `pnpm release:smoke-nsis-install`
- PowerShell checksum verification with `Get-FileHash`
- Electron smoke and performance smoke

Still required before publishing a Windows preview:

- installed app launch from installer, Start Menu, and desktop shortcut if
  created
- AppUserModelID and taskbar grouping verified
- Google OAuth Windows safeStorage token persistence verified across restart
- OAuth browser round trip verified
- MCP localhost smoke verified manually against Windows 11 installed app
- tray, global shortcut, notification, protocol registration/routing, and
  autostart behavior tested
- update-check UI verified against Windows assets
- interactive uninstall and retained-data behavior documented and tested
- filled target-host evidence template from
  `pnpm qa:evidence -- --target windows --dir release`
- code signing plan and SmartScreen expectations documented
- Windows preview support and retained-data policy documented

Windows preview may be unsigned only for local/internal testing. Public Windows distribution requires an explicit signing and SmartScreen plan.
The unsigned-preview policy and SmartScreen evidence checklist live in
[Windows Signing And SmartScreen](windows-signing-smartscreen.md).

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
