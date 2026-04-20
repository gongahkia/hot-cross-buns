# Apple Google Refactor Plan

## Decision

Build the next version as a native SwiftUI app for macOS. Remove the Go sync server and use Google Tasks plus Google Calendar as the sync backend. The iOS/iPadOS targets that existed during early scaffolding have been removed; this product is Mac-only.

> Status update: the Tauri prototype originally retained as reference material at `apps/desktop/` has since been deleted — the SwiftUI app diverged too far for the Tauri codebase to be useful as a comparison. This document preserves the original decision rationale.

## Current Implementation Status

- `apps/apple` now contains the native SwiftUI rewrite shell.
- The SwiftUI app uses `TabView` plus per-tab `NavigationStack` routing.
- The initial UI includes Today, Tasks, Calendar, and Settings screens.
- Google Tasks and Calendar REST client skeletons exist, but real OAuth is not wired yet.
- The macOS target builds locally with signing disabled.
- Local iOS build verification is blocked until the matching iOS platform components are installed in Xcode.

## Tauri Versus Swift

### Tauri Benefits

- Reuses web UI skills and libraries.
- One codebase can target desktop and mobile in principle.
- Small app bundles compared with Electron because Tauri uses the system webview.
- Rust backend is strong for local data processing and deterministic business logic.
- Existing repo already has a Tauri/Svelte/Rust implementation to mine for product behavior.

### Tauri Limitations For This Product

- iOS is not the primary Tauri strength; native mobile integrations still require Swift plugin work.
- Apple system features become bridged work instead of first-class app architecture.
- SwiftUI navigation, widgets, App Intents, background refresh, Keychain, notifications, and macOS menu/window conventions are easier to express natively.
- Google Sign-In and OAuth flows are cleaner in native Apple code than through a webview plus bridge.
- The existing Tauri app already has schema drift, sync drift, large components, and failing checks. Keeping it as the foundation means carrying old architectural debt into the new product.

### Swift Benefits

- Best fit for iOS-first behavior and Apple platform conventions.
- One Apple codebase can target iPhone, iPad, and Mac with SwiftUI, including Mac Catalyst or native multiplatform targets depending on the final packaging choice.
- Better access to Keychain, background refresh, local notifications, widgets, App Intents, Spotlight, Shortcuts, menus, and system calendar/contact affordances.
- Cleaner distribution path for macOS DMG builds through Xcode archives, Developer ID signing, and notarization.
- Lower impedance mismatch for Google Sign-In iOS/macOS SDKs and OAuth token handling.

### Swift Limitations

- Less reuse from the current Svelte UI.
- Requires Apple-specific implementation discipline: Swift concurrency, SwiftUI state ownership, Xcode project maintenance, signing, provisioning, and notarization.
- iOS background work is opportunistic, not guaranteed real time.
- Non-Apple platforms become non-goals unless a separate app is built later.
- macOS website distribution still needs Developer ID signing and notarization for a normal Gatekeeper experience.

## Recommended Source Of Truth

Use a Google-native source of truth:

- Google Tasks owns tasks.
- Google Calendar owns scheduled/time-based work.
- The local database owns cache, settings, pending offline mutations, and sync checkpoints only.

Do not introduce Google Drive for v1. Without Drive or a custom backend, app-only metadata will not reliably sync across devices unless it can be encoded into Google Tasks fields, Calendar fields, or Calendar extended properties. This is acceptable if the v1 feature set stays close to what Google Tasks and Calendar can represent.

## API Scope Strategy

Start with the narrowest useful scopes:

- Google Tasks read/write scope for task lists and tasks.
- Google Calendar read/write scope for selected calendars and events.
- Avoid Google Drive scopes entirely for v1.
- Request scopes incrementally when the user turns on the feature that needs them.

## Data Model

Initial local entities:

- `GoogleAccount`: account id, email display string, granted scopes, token status metadata.
- `TaskListMirror`: Google task list id, title, updated timestamp, etag.
- `TaskMirror`: Google task id, list id, parent id, title, notes, status, due date, completed timestamp, deleted/hidden flags, position, etag, updated timestamp.
- `CalendarListMirror`: calendar id, summary, color, selected flag, access role, etag.
- `CalendarEventMirror`: event id, calendar id, summary, description, start/end, recurrence, status, reminders, etag, updated timestamp.
- `SyncCheckpoint`: account id, resource type, resource id, calendar sync token, tasks updated-min watermark, last successful sync.
- `PendingMutation`: local operation queue for offline edits.
- `AppSettings`: sync aggressiveness, selected calendars/task lists, notification preferences, launch behavior.

Prefer SQLite with a thin repository layer if deterministic migrations and inspectable sync state matter. SwiftData is acceptable for a smaller prototype, but SQLite will be easier to reason about for sync checkpoints and conflict repair.

## Sync Plan

### Initial Sync

1. Sign in with Google.
2. Fetch task lists.
3. Fetch tasks per selected task list, including completed/deleted/hidden data where the UI needs it.
4. Fetch calendar list.
5. Fetch events for selected calendars and store each Calendar `nextSyncToken`.
6. Persist checkpoints and render from local cache.

### Incremental Sync

- Calendar: use `nextSyncToken` per calendar after initial sync.
- Tasks: use `updatedMin` watermarks per task list, plus periodic reconciliation because Tasks does not provide the same sync-token model as Calendar.
- Mutations: write through to Google when online; enqueue locally when offline; retry with backoff.
- Conflicts: prefer Google server state when etags or updated timestamps show remote changes after the local edit began. Surface unresolved conflicts only when overwriting user text would be destructive.

### Real-Time-ish Settings

Expose this as a user setting:

- Manual: no timers; user taps refresh.
- Balanced: refresh on launch, foreground activation, and every 5-15 minutes while foregrounded.
- Near real-time: refresh every 30-90 seconds while foregrounded, with rate-limit backoff and battery-aware pauses.

Use background refresh opportunistically on iOS. Do not promise instant sync on iOS without a server-side webhook-to-APNs relay.

## Implementation Phases

1. Remove Go server and old server docs. Done.
2. Mark Tauri desktop as deprecated reference. Done. (Subsequently deleted entirely once the Swift app outgrew it.)
3. Scaffold `apps/apple` as a SwiftUI multiplatform app. Done.
4. Add Google Sign-In and secure token storage.
5. Build local cache schema and repository layer.
6. Implement Google Tasks adapter.
7. Implement Google Calendar adapter.
8. Build sync scheduler and settings.
9. Build core UI: Today, Tasks, Calendar, Inbox, Settings.
10. Add macOS DMG release pipeline with Developer ID signing and notarization.
11. Decide later whether iOS distribution needs TestFlight, App Store, or internal device-only installs.

## Explicit Non-Goals For V1

- Google Drive integration.
- Custom sync server.
- Web app parity.
- Windows/Linux support.
- Migration from the existing Tauri SQLite database.
- Rich app-only metadata that cannot survive across Google clients.

## Research References

- Google Sign-In for iOS/macOS API access: https://developers.google.com/identity/sign-in/ios/api-access
- Google OAuth for native apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Google Tasks task resource: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks
- Google Tasks list method: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list
- Google Calendar incremental sync: https://developers.google.com/workspace/calendar/api/guides/sync
- Google Calendar push notifications: https://developers.google.com/workspace/calendar/api/guides/push
- Tauri overview: https://v2.tauri.app/start/
- Tauri mobile plugin development: https://v2.tauri.app/develop/plugins/develop-mobile/
- Apple macOS distribution outside the Mac App Store: https://help.apple.com/xcode/mac/current/en.lproj/dev033e997ca.html
