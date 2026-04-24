# Releasing

Hot Cross Buns ships as a macOS DMG through GitHub Releases. Unsigned preview DMGs and signed/notarized DMGs use the same release flow; the difference is whether Developer ID secrets are present.

## One-Time Setup

### Google Sign-In Release Config

Public DMGs must embed a real macOS OAuth client in the built app:

1. Create a macOS OAuth client for bundle ID `com.gongahkia.hotcrossbuns.mac`.
2. Provide `GOOGLE_MACOS_CLIENT_ID` and `GOOGLE_MACOS_REVERSED_CLIENT_ID` via local xcconfig or CI secrets.
3. Verify the packaged app's `Info.plist` does not contain unresolved `$(...)` placeholders before shipping.

### Optional Developer ID Signing

See `URGENT-TODO.md` §5 for the full list of GitHub secrets required for DMG signing and notarization.

## Release Flow

1. Bump `MARKETING_VERSION` in `apps/apple/project.yml` and `CURRENT_PROJECT_VERSION`.
2. Commit, tag `vX.Y.Z`, push the tag.
3. The `release` workflow regenerates the Xcode project via `xcodegen`, injects Google OAuth release secrets, runs `scripts/package-macos-dmg.sh`, creates the stable `HotCrossBuns-macOS.dmg` alias, smoke-tests the DMG, generates `.sha256` checksum files, and attaches everything to the GitHub release.
4. The website download button and install script target `releases/latest/download/HotCrossBuns-macOS.dmg`.
5. Existing installs check GitHub Releases for a newer DMG and guide the user through a manual replace.

## Local Dry Run

```bash
CODE_SIGN_IDENTITY="Developer ID Application: Example Team (TEAMID)" \
NOTARIZE=1 \
APPLE_ID="you@example.com" \
APPLE_TEAM_ID="TEAMID" \
APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
scripts/package-macos-dmg.sh
```

The resulting DMG is written to `build/apple/`. The packaging script auto-detects `Hot Cross Buns.app` in DerivedData and warns when Google OAuth values are still placeholders. Inspect the signed artifact with `spctl --assess --type open --context context:primary-signature` before publishing.
