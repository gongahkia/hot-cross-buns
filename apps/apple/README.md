# Apple App

Hot Cross Buns macOS app: a native SwiftUI client for Google Tasks and Google Calendar.

## Direction

- Google Tasks and Google Calendar are the source of truth.
- Local storage is cache, settings, sync checkpoints, and pending offline mutations.
- Google Drive is out of scope.
- Mac-only. iOS/iPadOS targets have been removed from this project.

## Requirements

- Xcode 15+ or newer
- XcodeGen 2.45+
- macOS 14+ target

## Generate The Project

```bash
cd apps/apple
xcodegen generate
open HotCrossBuns.xcodeproj
```

## Build From CLI

```bash
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
xcodebuild -project HotCrossBuns.xcodeproj -scheme HotCrossBunsMac -destination 'platform=macOS' test CODE_SIGNING_ALLOWED=NO
```

## Package macOS DMG

```bash
../../scripts/package-macos-dmg.sh
```

The script creates an unsigned DMG under `build/apple/` by default. If `CODE_SIGN_IDENTITY` is set, it signs the app bundle and DMG. If `NOTARIZE=1` is also set, it submits the DMG with `xcrun notarytool` using `APPLE_ID`, `APPLE_TEAM_ID`, and `APP_SPECIFIC_PASSWORD`, then staples the result.

## Google Integration

The app uses the native Google Sign-In SDK and requests these Google scopes during sign-in:

- `https://www.googleapis.com/auth/tasks`
- `https://www.googleapis.com/auth/calendar`

Create a Google Cloud OAuth client for macOS, then provide these build settings locally:

- `GOOGLE_MACOS_CLIENT_ID`
- `GOOGLE_MACOS_REVERSED_CLIENT_ID`

The committed defaults are intentionally blank in `Configuration/GoogleOAuth.xcconfig`, and that file optionally includes the ignored `Configuration/GoogleOAuth.local.xcconfig` when present. Use `Configuration/GoogleOAuth.example.xcconfig` as the template for your local override and do not commit real OAuth client IDs. You can also pass values directly to `xcodebuild` if you prefer.

Public DMGs are packaged locally. Before running the local release commands, create `Configuration/GoogleOAuth.local.xcconfig` with `GOOGLE_MACOS_CLIENT_ID` and `GOOGLE_MACOS_REVERSED_CLIENT_ID` so the uploaded app can use the production Google OAuth client.

```bash
xcodebuild \
  -project HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS' \
  GOOGLE_MACOS_CLIENT_ID='your-client-id.apps.googleusercontent.com' \
  GOOGLE_MACOS_REVERSED_CLIENT_ID='com.googleusercontent.apps.your-reversed-client-id' \
  build
```

## Mac Shell

The app uses a NavigationSplitView sidebar shell with a full CommandMenu (`⌘N` new task, `⌘⇧N` new event, `⌘R` refresh, `⌘⇧R` force full resync, `⌘F` search, `⌘1…⌘5` section switching) and window-state restoration. A menu-bar extra and dock overdue-count badge are available as optional user settings.

## Local Cache

The current cache is a JSON app-state snapshot in Application Support under `~/Library/Application Support/com.gongahkia.hotcrossbuns.mac/`. It is intentionally small and replaceable: it preserves account metadata, task/calendar mirrors, sync checkpoints, pending mutation placeholders, and user settings so launch does not depend on an immediate Google round trip. Event mirrors live in a `cache-events.json` sidecar so routine saves stay smaller. A SQLite-backed cache can replace this once offline mutation replay needs stronger migrations.

OAuth tokens live in the macOS Keychain. Optional cache encryption uses AES-256-GCM for the local cache files only; Google remains the source of truth for synced tasks and events. The app does not ship a third-party analytics SDK or cloud crash reporter.

## Onboarding

First launch presents a setup flow for Google Sign-In, sync mode, task-list/calendar selection, and local reminders. The setup state is persisted in the local cache and can be reset from Settings.

## Search

The Search section queries the local cache for synced tasks and calendar events by title, notes/details, source list/calendar, and status. Search is intentionally local-first so it remains fast and does not spend Google API quota per keystroke. Tasks and events are also indexed in Spotlight for system-wide Mac search.

## Error UX

Sync and Google connection failures surface in a global banner with dismiss and retry actions. Google API status codes are translated into user-actionable messages where possible.

## Diagnostics And Recovery

Settings includes a Diagnostics and Recovery sheet for daily-use support. It shows account, sync, cache, selection, checkpoint, and pending-write state; can copy a diagnostic summary; can refresh immediately; can force a full resync by clearing checkpoints; and can clear cached Google data on this device before reloading from Google. These controls do not delete data from Google.

## Sync

Manual refresh performs authenticated read-sync against Google Tasks task lists/tasks and Google Calendar calendar lists/events. Initial sync performs full reads for selected resources; later syncs use Google Tasks `updatedMin` checkpoints and Google Calendar `nextSyncToken` checkpoints. Tombstones are purged from the local cache after each successful sync. Near-real-time polling uses jittered exponential backoff on `429` and `5xx` responses.

Sync modes:

- Manual only syncs when the user taps refresh.
- Balanced syncs after launch/restore and when the scene becomes active.
- Near real-time does the balanced behavior plus foreground polling every 90 seconds with backoff.

Settings persist selected calendars and selected task lists. Empty selections are respected after the user has configured them, rather than falling back to Google defaults.

## Local Notifications

Local reminders are opt-in from Settings. When enabled, the app requests notification permission and schedules up to 64 pending device-local notifications for incomplete due tasks and upcoming non-cancelled Calendar events. Task reminders fire at 9:00 AM on the due date; timed event reminders fire 15 minutes before start; all-day event reminders fire at 9:00 AM.

## App Intents

The app exposes App Shortcuts for opening the task editor, opening the event editor, and opening Today.

## Task Writes

The Tasks section includes online task create, edit, complete/reopen, and delete flows backed by Google Tasks `tasks.insert`, `tasks.patch`, and `tasks.delete`. It also supports creating, renaming, and deleting task lists.

## Calendar Writes

The Calendar section includes online timed and all-day event create, edit, and delete flows backed by Google Calendar `events.insert`, `events.patch`, and `events.delete`. Event forms support custom popup reminders.

## Distribution And Updates

Preview DMGs are distributed through GitHub Releases. Each release publishes a matching SHA-256 checksum file alongside the DMG, and `docs/install-macos-preview.sh` verifies that checksum before installing.

Unsigned preview builds should not promise in-place auto-updates. Hot Cross Buns can check GitHub Releases for a newer DMG and open the download for you, but installation still remains a manual replace until the app gains a separate in-place updater.
