# Apple App

This is the new primary Hot Cross Buns app surface: a native SwiftUI rewrite for iOS, iPadOS, and macOS.

## Direction

- Google Tasks and Google Calendar are the source of truth.
- Local storage is cache, settings, sync checkpoints, and pending offline mutations.
- Google Drive is out of scope for v1.
- The deprecated Tauri app remains only as product reference material.

## Requirements

- Xcode 15+ or newer
- XcodeGen 2.45+
- iOS 17+ target
- macOS 14+ target

## Generate The Project

```bash
cd apps/apple
xcodegen generate
open HotCrossBuns.xcodeproj
```

## Build From CLI

```bash
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBuns -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
```

The macOS build command is verified in this repo. The iOS command requires the matching iOS simulator platform components installed in Xcode.

## Google Integration

The app shell includes compile-time-safe Google Tasks and Calendar client skeletons. Real sign-in needs Google Cloud OAuth client IDs and URL scheme configuration before access tokens can be requested.
