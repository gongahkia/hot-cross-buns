# Melon Pan — macOS Shell

SwiftUI app shell over the Rust runtime.

## Architecture

```text
MelonPan (SwiftUI)
   ↓ Swift bridging header
   ↓ Bridge/RuntimeBridge.swift
   ↓ extern "C" + JSON
crates/melon-pan-mac-ffi  (libmelon_pan_mac_ffi.a)
   ↓
crates/melon-pan-mac-runtime  (Keychain TokenStore, NSWorkspace launcher)
   ↓
crates/melon-pan-runtime-shared  (sync_ops, oauth_flow, drive_ops, ...)
   ↓
crates/melon-pan-core  (transpiler, audit, model, json, ...)
```

The default cache root is `~/Library/Caches/MelonPan/`. User settings and OAuth credentials live under `~/Library/Application Support/MelonPan/`.

## Build

Two-step development build:

```sh
# 1. Universal libmelon_pan_mac_ffi.a (arm64 + x86_64) plus bridging header.
scripts/build-rust-staticlib.sh release

# 2. Generate Xcode project + build.
brew install xcodegen
xcodegen generate
xcodebuild -project MelonPan.xcodeproj -scheme MelonPan -configuration Release
```

The `MelonPan/Build/`, `dist/`, and `*.xcodeproj/` directories are gitignored; all regenerate from repo state on every build.

### Packaging (Unsigned)

```sh
# Produces dist/MelonPan-<version>.dmg. Unsigned.
scripts/package-dmg.sh
```

The DMG contains `MelonPan.app` plus an `Applications` symlink so a drag-to-install works from a Finder mount. To sign and notarize before distribution:

```sh
codesign --options=runtime \
         --entitlements MelonPan/MelonPan.entitlements \
         --sign "Developer ID Application: YOUR NAME" \
         "<dmg-mount>/MelonPan.app"
xcrun notarytool submit dist/MelonPan-<version>.dmg --wait \
      --apple-id ... --team-id ... --password ...
xcrun stapler staple dist/MelonPan-<version>.dmg
```

Sparkle is intentionally not wired. Distribution is "download a fresh DMG from GitHub Releases"; the in-app updater (Settings -> Updates) is the discovery path and the DMG is the install path.

## Layout

```text
apps/macos/melon-pan-mac/
├── project.yml                       xcodegen manifest
├── scripts/
│   └── build-rust-staticlib.sh       cargo + lipo for libmelon_pan_mac_ffi.a
├── MelonPan/
│   ├── MelonPanApp.swift             @main + AppSession
│   ├── Bridge/
│   │   ├── MelonPan-Bridging-Header.h
│   │   └── RuntimeBridge.swift       Codable wrappers over the C ABI
│   ├── Views/
│   │   ├── ContentView.swift         NavigationSplitView shell
│   │   ├── WelcomeView.swift
│   │   ├── EditorPane.swift          editor host
│   │   ├── DrivePane.swift
│   │   ├── ConflictsPane.swift
│   │   ├── DiagnosticsPane.swift
│   │   └── SettingsView.swift
│   └── Resources/
│       └── web-editor/               app-owned editor bundle
└── README.md                         this file
```

## Status

- Keychain token store via `security-framework`.
- `/usr/bin/open` browser launch.
- Path resolution and cache initialization through the FFI.
- OAuth loopback flow.
- Drive tree refresh and hierarchical sidebar.
- Editor `current.md` round-trip with autosave and Cmd-S push.
- Conflicts page for pending mutations and snapshot restore.
- Multi-tab editor with `windows.json` restoration across launches.
- Native notifications via `UNUserNotificationCenter`.
- Manual updater check.
- Diagnostics page.
- Unsigned DMG packaging.
