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

## Package macOS DMG

```bash
../../scripts/package-macos-dmg.sh
```

The packaging script creates an unsigned DMG under `build/apple/` by default. Website distribution should eventually enable Developer ID signing and notarization before publishing the artifact.

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

The current cache is a JSON app-state snapshot in Application Support. It is intentionally small and replaceable: it preserves account metadata, task/calendar mirrors, sync checkpoints, pending mutation placeholders, and user settings so launch does not depend on an immediate Google round trip. A SQLite-backed cache can replace this once offline mutation replay needs stronger migrations.

## Onboarding

First launch presents a setup flow for Google Sign-In, sync mode, task-list/calendar selection, and local reminders. The setup state is persisted in the local cache and can be reset from Settings.

## Sync

Manual refresh now performs authenticated read-sync against Google Tasks task lists/tasks and Google Calendar calendar lists/events. Initial sync performs full reads for selected resources; later syncs use Google Tasks `updatedMin` checkpoints and Google Calendar `nextSyncToken` checkpoints. Offline mutation replay is still pending.

Sync modes are active:

- Manual only syncs when the user taps refresh.
- Balanced syncs after launch/restore and when the scene becomes active.
- Near real-time does the balanced behavior plus foreground polling every 90 seconds.

Settings persist selected calendars and selected task lists. Empty selections are respected after the user has configured them, rather than falling back to Google defaults.

## Local Notifications

Local reminders are opt-in from Settings. When enabled, the app requests notification permission and schedules up to 64 pending device-local notifications for incomplete due tasks and upcoming non-cancelled Calendar events. Task reminders fire at 9:00 AM on the due date; timed event reminders fire 15 minutes before start; all-day event reminders fire at 9:00 AM.

## App Intents

The app exposes first-pass App Shortcuts for opening the task editor, opening the event editor, and opening Today. These are foreground handoff intents: Shortcuts writes a pending route, opens the app, and the SwiftUI shell presents the relevant destination. Direct background Google mutations are intentionally deferred until the offline mutation queue and conflict policy are stronger.

## Task Writes

The Tasks tab includes online create, edit, complete/reopen, and delete flows backed by Google Tasks `tasks.insert`, `tasks.patch`, and `tasks.delete`. These require a signed-in Google account and loaded task lists from refresh. Offline queueing, conflict handling, task reordering, and task-list management are still pending.

## Calendar Writes

The Calendar tab includes online timed-event create, edit, and delete flows backed by Google Calendar `events.insert`, `events.patch`, and `events.delete`. All-day event creation/editing, recurrence, attendees, reminders, event moves, and conflict handling are later product slices.
