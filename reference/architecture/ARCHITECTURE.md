# Architecture

Hot Cross Buns is a macOS-native Google Tasks and Google Calendar client.

The old architecture was a Tauri desktop app plus an optional Go/PostgreSQL sync server. Both have been removed — the Tauri prototype at `apps/desktop/` was deleted once the SwiftUI app reached feature parity and diverged. iOS/iPadOS targets have also been removed; this product is Mac-only.

## Target Architecture

```text
apps/apple SwiftUI app
  -> GoogleAuthService
  -> TaskSyncService      -> Google Tasks API
  -> CalendarSyncService  -> Google Calendar API
  -> LocalCacheStore      -> local SQLite or SwiftData cache
  -> SyncScheduler        -> foreground polling, background refresh, manual refresh
```

## Product Boundaries

The target product is strongest when understood as:

- Apple-first: iOS, iPadOS, and macOS are the supported platforms.
- Google-native: Google Tasks and Google Calendar are the source of truth.
- Offline-capable: local data is a cache, not a separate canonical database.
- Single-user first: personal/internal use before public distribution.
- Serverless by default: no custom sync backend unless webhook relay becomes necessary.

It is not currently optimized for:

- Windows, Linux, or Android parity.
- Collaboration beyond what Google already supports.
- App-specific task features that cannot be represented in Google Tasks or Calendar.
- Google Drive file management.

## Current Apple App Structure

```text
apps/apple/
  project.yml                         XcodeGen project spec
  HotCrossBuns.xcodeproj/             Generated project for Xcode users
  HotCrossBuns/App/                   SwiftUI app entrypoint, tab shell, routing, root model
  HotCrossBuns/Features/              Today, Tasks, Calendar, Settings screens
  HotCrossBuns/Models/                Google mirror models, sync state, snapshots
  HotCrossBuns/Services/Auth/         Google auth boundary
  HotCrossBuns/Services/Google/       Google Tasks and Calendar REST clients
  HotCrossBuns/Services/Persistence/  Local cache boundary
  HotCrossBuns/Services/Sync/         Sync scheduler boundary
```

The current implementation intentionally uses mock cached data and compile-time-safe Google client skeletons. Real Google Sign-In requires OAuth client IDs, URL schemes, and secure token storage wiring before API calls can be made.

## Source Of Truth

Use Google-native source of truth for the first Apple-native version.

The local cache should store:

- Google account identity metadata.
- Task lists, tasks, calendar lists, and events mirrored from Google.
- Sync checkpoints such as Calendar `nextSyncToken` values and Tasks `updatedMin` watermarks.
- Local UI preferences and sync settings.
- Pending local mutations when offline.

The local cache should not become an independent sync model. If data cannot be represented in Google Tasks or Calendar, treat it as local-only until there is a deliberate product reason to add another cloud storage layer.

## Google Tasks Mapping

Google Tasks should back task-oriented data:

- task lists
- task title
- notes/details
- due date
- completion status
- parent/subtask relationships
- deleted/hidden/completed filtering

Important constraint: Google Tasks due dates are date-based through the public API. Time-specific scheduling belongs in Google Calendar, not Google Tasks.

## Google Calendar Mapping

Google Calendar should back scheduled data:

- events
- time blocks
- recurring events
- reminders exposed by Calendar
- calendar selection and visibility
- app metadata for calendar events via private extended properties when useful

Calendar supports incremental sync tokens, so the app should avoid full calendar reloads after the initial sync.

## Sync Model

Baseline sync should be configurable:

- Manual: refresh only when the user requests it.
- Balanced: refresh on app launch, foreground activation, pull-to-refresh, and periodic foreground timers.
- Near real-time: shorter foreground polling intervals plus background refresh where Apple permits it.

True push is not fully serverless:

- Google Calendar push notifications require an HTTPS webhook receiver.
- Google Tasks does not expose the same Calendar-style webhook flow in the public Tasks API documentation.
- iOS apps cannot receive Google webhook POSTs directly, so a future push path would need a small webhook relay that sends APNs notifications to devices.

That relay should be considered notification infrastructure only, not a resurrection of the old data sync server.

## Historical Reference (removed)

The Tauri app previously at `apps/desktop/` is no longer in the repo, but the design decisions it informed survive in the Swift app:

- task list layout
- planning views
- filtering behavior
- command palette ideas
- import/export ideas

Its Rust/SQLite schema was deliberately not carried forward as the canonical model. That schema was designed for local-first Tauri sync, not Google-native data ownership.
