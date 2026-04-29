# Releasing

Hot Cross Buns ships as a macOS DMG through GitHub Releases. The current release policy is:

**Build the DMG locally, then upload it to GitHub Releases. Do not use GitHub Actions to build release DMGs.**

The old GitHub Actions DMG release workflow was removed intentionally. The local build path is the source of truth because it uses the maintainer's local Xcode installation and local ignored Google OAuth config. GitHub's macOS runner has previously failed the release build on compiler/type-checker behavior that does not reproduce locally. Do not spend release time trying to restore the remote DMG workflow unless the project explicitly decides to reintroduce remote packaging.

## One-Time Setup

### Google Sign-In Release Config

Public DMGs can ship without embedded OAuth values because users can add their own Google Cloud `Desktop app` OAuth client in Settings at runtime.

Personal or turnkey DMGs can still embed a real macOS OAuth client owned by the person using the build:

1. Create a macOS OAuth client for bundle ID `com.gongahkia.hotcrossbuns.mac`.
2. Put the values in the ignored local config file:

```bash
cat > apps/apple/Configuration/GoogleOAuth.local.xcconfig <<'EOF'
GOOGLE_MACOS_CLIENT_ID = your-client-id.apps.googleusercontent.com
GOOGLE_MACOS_REVERSED_CLIENT_ID = com.googleusercontent.apps.your-reversed-client-id
GOOGLE_MAPS_EMBED_API_KEY =
EOF
```

3. Verify the packaged app's `Info.plist` does not contain unresolved `$(...)` placeholders before shipping.
4. For personal daily use, keep the Google OAuth app set to external/in production so refresh tokens are not forced to expire after 7 days.

Do not upload a public DMG with a private personal embedded OAuth client unless you intend to complete Google's public OAuth verification path for that client.

### Local Tooling

Install XcodeGen and authenticate GitHub CLI once:

```bash
brew install xcodegen
gh auth login
```

The GitHub CLI token only needs normal repository access to create/upload releases. It does not need the `workflow` scope unless you are editing workflow files.

### Optional Developer ID Signing

Unsigned/unnotarized DMGs are the current free distribution path. If Developer ID signing is added later, keep using the local packaging script and pass signing/notarization environment variables locally.

## Release Flow

Use this flow for every DMG release.

1. Pick the version, for example `0.1.1`.
2. If needed, update `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `apps/apple/project.yml`.
3. Commit and push the application/docs changes to `main`.
4. Tag the exact commit that should ship.
5. Build the DMG locally.
6. Create the stable `HotCrossBuns-macOS.dmg` alias.
7. Smoke-test the DMG.
8. Generate checksums.
9. Create or update the GitHub Release assets.

Exact commands:

```bash
VERSION=0.1.1

git status --short
git push origin main

git tag "v$VERSION"
git push origin "v$VERSION"

VERSION="$VERSION" ./scripts/package-macos-dmg.sh

cp "build/apple/HotCrossBuns-$VERSION-macOS.dmg" \
  build/apple/HotCrossBuns-macOS.dmg

bash scripts/smoke-test-dmg.sh "build/apple/HotCrossBuns-$VERSION-macOS.dmg"

shasum -a 256 "build/apple/HotCrossBuns-$VERSION-macOS.dmg" \
  | awk '{print $1}' > "build/apple/HotCrossBuns-$VERSION-macOS.dmg.sha256"

shasum -a 256 build/apple/HotCrossBuns-macOS.dmg \
  | awk '{print $1}' > build/apple/HotCrossBuns-macOS.dmg.sha256

gh release create "v$VERSION" \
  "build/apple/HotCrossBuns-$VERSION-macOS.dmg" \
  "build/apple/HotCrossBuns-$VERSION-macOS.dmg.sha256" \
  build/apple/HotCrossBuns-macOS.dmg \
  build/apple/HotCrossBuns-macOS.dmg.sha256 \
  --title "Hot Cross Buns v$VERSION" \
  --generate-notes
```

If the release already exists, upload/replace the assets instead:

```bash
VERSION=0.1.1

gh release upload "v$VERSION" \
  "build/apple/HotCrossBuns-$VERSION-macOS.dmg" \
  "build/apple/HotCrossBuns-$VERSION-macOS.dmg.sha256" \
  build/apple/HotCrossBuns-macOS.dmg \
  build/apple/HotCrossBuns-macOS.dmg.sha256 \
  --clobber
```

The website download button and install script target the stable latest-release asset:

```text
https://github.com/gongahkia/hot-cross-buns/releases/latest/download/HotCrossBuns-macOS.dmg
```

That stable alias must be uploaded for every release.

## Local Dry Run

```bash
VERSION=dev ./scripts/package-macos-dmg.sh
bash scripts/smoke-test-dmg.sh build/apple/HotCrossBuns-dev-macOS.dmg
```

The resulting DMG is written to `build/apple/`. Runtime Desktop OAuth setup means a public DMG does not need embedded Google OAuth values, but if you intentionally build with embedded values, verify the packaged app's `Info.plist` does not contain unresolved `$(...)` placeholders.

## Notes For Future Agents

- Do not recreate `.github/workflows/release.yml` for DMG packaging by default.
- Keep `.github/workflows/ci.yml` for normal build/test checks.
- Local DMG packaging is intentional and sufficient for the unsigned/free distribution path.
- Users can download the uploaded unsigned DMG from GitHub Releases; macOS may require `System Settings > Privacy & Security > Open Anyway` on first launch.
