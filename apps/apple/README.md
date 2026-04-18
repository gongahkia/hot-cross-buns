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

The app uses the native Google Sign-In SDK and requests Google Tasks plus Google Calendar scopes during sign-in.

Create separate Google Cloud OAuth clients for iOS and macOS, then provide these build settings locally:

- `GOOGLE_IOS_CLIENT_ID`
- `GOOGLE_IOS_REVERSED_CLIENT_ID`
- `GOOGLE_MACOS_CLIENT_ID`
- `GOOGLE_MACOS_REVERSED_CLIENT_ID`

The committed defaults are intentionally blank. Use `Configuration/GoogleOAuth.example.xcconfig` as a reference and do not commit real OAuth client IDs. You can pass values directly to `xcodebuild`, set them as local Xcode user build settings, or wire a local ignored xcconfig in your own working copy.

Example CLI override:

```bash
xcodebuild \
  -project HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS' \
  GOOGLE_MACOS_CLIENT_ID='your-client-id.apps.googleusercontent.com' \
  GOOGLE_MACOS_REVERSED_CLIENT_ID='com.googleusercontent.apps.your-reversed-client-id' \
  build
```

## Local Cache

The current cache is a JSON app-state snapshot in Application Support. It is intentionally small and replaceable: it preserves account metadata, task/calendar mirrors, and user settings so launch does not depend on an immediate Google round trip. A SQLite-backed cache can replace this once the sync checkpoint and mutation schema are stable.

## Sync

Manual refresh now performs authenticated read-sync against Google Tasks task lists/tasks and Google Calendar calendar lists/events. Calendar reads currently fetch from the start of the current day, while Tasks performs full-list reads; incremental checkpoints and offline mutation replay are still pending.
