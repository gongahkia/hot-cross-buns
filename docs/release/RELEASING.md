# Releasing

Hot Cross Buns ships as a signed, notarized macOS DMG with Sparkle auto-updates.

## One-Time Setup

### Sparkle Signing Keys

1. Build Sparkle's `generate_keys` tool once (the Sparkle SwiftPM package bundles it under `bin/generate_keys` in derived data; the tool is also available from Sparkle GitHub releases).
2. Run `./generate_keys`. It prints a public key and stores the private key in the login keychain.
3. Copy the private key into the GitHub Actions secret `SPARKLE_PRIVATE_KEY`.
4. Paste the public key into `HotCrossBuns/Support/Info-macOS.plist` under `SUPublicEDKey`, or pass it via an xcconfig.
5. Enable GitHub Pages on the `gh-pages` branch of this repository.

### Developer ID Signing

See `URGENT-TODO.md` §5 for the full list of GitHub secrets required for DMG signing and notarization.

## Release Flow

1. Bump `MARKETING_VERSION` in `apps/apple/project.yml` and `CURRENT_PROJECT_VERSION`.
2. Commit, tag `vX.Y.Z`, push the tag.
3. The `release` workflow regenerates the Xcode project via `xcodegen`, runs `scripts/package-macos-dmg.sh` with the Developer ID identity and notarization credentials, invokes Sparkle's `generate_appcast` against the built DMG, and publishes the DMG and updated `appcast.xml` to the `gh-pages` branch.
4. GitHub Pages serves `https://gongahkia.github.io/hot-cross-buns/appcast.xml` and the DMG URL referenced in the appcast.
5. Existing installs pick up the new version via Sparkle's in-app update prompt.

## Local Dry Run

```bash
CODE_SIGN_IDENTITY="Developer ID Application: Example Team (TEAMID)" \
NOTARIZE=1 \
APPLE_ID="you@example.com" \
APPLE_TEAM_ID="TEAMID" \
APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
scripts/package-macos-dmg.sh
```

The resulting DMG is written to `build/apple/`. Inspect it with `spctl --assess --type open --context context:primary-signature` before publishing.
