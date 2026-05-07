# Distribution

Melon Pan is distributed as a macOS app bundle inside an unsigned DMG during development.

## Local DMG

```sh
cd apps/macos/melon-pan-mac
scripts/package-dmg.sh
```

The script builds `MelonPan.app`, creates `dist/MelonPan-<version>.dmg`, and places an `Applications` symlink in the image for drag-to-install.

## Signing And Notarization

Release distribution requires a Developer ID Application certificate and Apple notarization:

```sh
codesign --options=runtime \
         --entitlements MelonPan/MelonPan.entitlements \
         --sign "Developer ID Application: YOUR NAME" \
         "<dmg-mount>/MelonPan.app"

xcrun notarytool submit dist/MelonPan-<version>.dmg --wait \
      --apple-id ... --team-id ... --password ...

xcrun stapler staple dist/MelonPan-<version>.dmg
```

Sparkle is intentionally not wired. The in-app updater checks GitHub Releases and directs users to download a fresh DMG.
