# URGENT-TODO

Outstanding items for the Mac-only refactor push and v0.1.0 release. Everything below is either unblocking for shipping, requires live-device/account access, or is an open product decision. Feature-depth work (calendar grid, subtasks, recurrence, offline queue) is tracked under "Deferred work".

## 1. Verify the new test suites run green

### What's already confirmed
- `xcodebuild ... build` succeeds on macOS with signing off.
- `ModelPersistenceTests` (5 tests) and `SpotlightIdentifierTests` (3 tests) executed and passed on the last run.

### What's unconfirmed
- `BackoffPolicyTests` (5 cases)
- `AppSettingsMacSurfacesTests` (2 cases)
- `SyncSchedulerTombstonePurgeTests` (1 case)

The previous run started `SyncSchedulerTombstonePurgeTests` then xcodebuild aborted with a **result-bundle save error** (`mkstemp: No such file or directory` coming out of `IDETesting`), not a test failure. Xcode 26.4 beta has a known issue here when DerivedData is cleaned mid-build.

### Commands to verify
```bash
cd apps/apple

# reset only the CAS path that trips the save error; leave SPM cache alone.
xcodebuild -project HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS,arch=arm64' \
  clean

xcodebuild -project HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS,arch=arm64' \
  test CODE_SIGNING_ALLOWED=NO | tee /tmp/hcb-test.log

# pass criteria:
grep -E 'Executed [0-9]+ tests, with 0 failures' /tmp/hcb-test.log | wc -l
# expect 5 (one per suite).
```

### If the result-bundle save error re-occurs
It's a sandboxing / CAS issue local to the Xcode 26 beta. Two workarounds, in order of cost:
1. Run tests with `-disableAutomaticPackageResolution -skipPackagePluginValidation` and redirect the result bundle: `-resultBundlePath "$PWD/build/apple/TestResults"`.
2. If still flaky, temporarily switch DerivedData off `/Users/...` (the default) to a path in `$PWD/build/apple/DerivedData`: pass `-derivedDataPath build/apple/DerivedData` to the same command.

### If a real test failure surfaces
Most likely suspect is `SyncSchedulerTombstonePurgeTests` — it uses a private `MergePurgeFixture` that re-implements the scheduler's post-merge filter. If `SyncScheduler.mergeTasks` / `mergeEvents` later change shape (sorting, recurrence handling), update the fixture to match. The real merge logic lives in `apps/apple/HotCrossBuns/Services/Sync/SyncScheduler.swift`.

## 2. Confirm the single-window + sidebar fix on-device

Code changes landed (`HotCrossBunsApp.swift` uses `Window("Hot Cross Buns", id: "main")` with `.windowResizability(.contentMinSize)`; `MacSidebarShell.swift` defaults `NavigationSplitViewVisibility.all`). On-device verification still outstanding.

**Verify manually:**
- `open build/apple/DerivedData/Build/Products/Debug/HotCrossBunsMac.app` twice in a row — second launch should just foreground the existing window, not create a new one.
- Cmd+N invokes "New Task" (our override), not "New Window".
- Sidebar lists Today / Tasks / Calendar / Search / Settings and renders badges for Today/Tasks counts.

## 3. Google OAuth wiring

Cannot be done from repo code alone. `apps/apple/Configuration/GoogleOAuth.xcconfig` is still absent (only `.example` present), so `GoogleAuthService.isConfigured` returns false and sign-in is disabled.

- Create or choose a Google Cloud project for Hot Cross Buns.
- Enable the Google Tasks API and Google Calendar API in that project.
- Configure OAuth consent for personal/internal use.
- Create an OAuth client ID for the macOS bundle ID `com.gongahkia.hotcrossbuns.mac`.
- Copy `apps/apple/Configuration/GoogleOAuth.example.xcconfig` to `GoogleOAuth.xcconfig` (already in `.gitignore`) and fill in:
  ```
  GOOGLE_MACOS_CLIENT_ID = <client id>.apps.googleusercontent.com
  GOOGLE_MACOS_REVERSED_CLIENT_ID = com.googleusercontent.apps.<reversed id>
  ```
- In Xcode, attach that xcconfig to the `HotCrossBunsMac` target's Debug + Release configurations.
- Verify sign-in, disconnect, reconnect, and incremental scope grant behavior with a real Google account.

## 4. Sparkle auto-update provisioning

`SUPublicEDKey` is still missing from `apps/apple/HotCrossBuns/Support/Info-macOS.plist`. Sparkle will refuse updates without it.

- Run Sparkle's `generate_keys` (bundled in the SwiftPM package's derived-data directory, or downloadable from the Sparkle GitHub release) once per machine.
- Paste the **public** key into `Info-macOS.plist` under `SUPublicEDKey` via a build setting or direct edit.
- Store the **private** key as GitHub Actions secret `SPARKLE_PRIVATE_KEY`.
- Enable GitHub Pages on the `gh-pages` branch so `https://gongahkia.github.io/hot-cross-buns/appcast.xml` serves.
- Confirm the first release publishes an appcast entry and that a previously installed build picks it up via in-app "Check for Updates".

See `docs/RELEASING.md` for the end-to-end flow.

## 5. Apple Developer ID + notarization

GitHub Actions release workflow references these secrets (not yet set); without them the DMG ships unsigned and Gatekeeper warns on first open.

- Enroll or sign in with the intended Apple Developer account.
- Create/export a Developer ID Application certificate as a `.p12` for website DMG distribution.
- Add these GitHub Actions secrets for release signing in CI:
  - `MACOS_DEVELOPER_ID_P12_BASE64`
  - `MACOS_DEVELOPER_ID_P12_PASSWORD`
  - `MACOS_DEVELOPER_ID_APPLICATION`
  - `KEYCHAIN_PASSWORD`
  - `APPLE_ID`
  - `APPLE_TEAM_ID`
  - `APP_SPECIFIC_PASSWORD`
  - `NOTARIZE_MACOS_DMG` set to `1`
- Download the CI DMG and confirm Gatekeeper opens it without unsigned-app warnings.

## 6. Live product QA

Dogfood with a real account for at least one workday on macOS. Smoke checklist (10 min):

1. Sign in with real Google account via Settings → Google account → Connect Google.
2. Refresh; confirm task lists + calendars populate.
3. Create a task → confirm it appears in Google Tasks web UI.
4. Verify task edit / complete / reopen / delete round-trips against Google Tasks web UI.
5. Create an all-day event and a timed event → confirm they appear in Google Calendar web UI with the configured reminder.
6. Verify event edit / delete, all-day event behavior, and popup reminders against Google Calendar web UI.
7. Delete a task in the web UI; trigger Refresh in-app; verify the task disappears (tombstone purge working).
8. Confirm selected task lists/calendars persist across app relaunches and sync cycles.
9. Confirm local reminders are neither duplicated nor stale after edits/deletes.
10. Toggle `Menu bar extra` off/on in Settings → confirm the menu bar icon hides/shows.
11. Toggle `Dock badge for overdue tasks` off → confirm badge clears; on → matches overdue count.
12. Spotlight for a task title → confirm a result appears and clicking opens the task detail inside the app.
13. Confirm menu bar extra popover renders and quick-add works.
14. Sync menu → Check for Updates → confirm Sparkle dialog opens (will show "no updates" until an appcast entry is published).

## 7. Product decisions (locked)

- **Attendee emails**: ask every time via checkbox in the event editor, default off. Matches Google Calendar web behavior without surprising mass-emails.
- **Recurrence UI**: Daily/Weekly/Monthly/Yearly presets plus a "Custom…" expander (interval, weekday picker, end = never/on date/after N). No raw RRULE string; no natural-language parsing in v1.
- **Offline writes**: optimistic with temporary local IDs; task/event appears instantly marked "pending sync"; ID is remapped when Google accepts. Requires ID-remap handling in any relation (e.g. subtasks once added).
- **App Intents**: foreground handoff only — Shortcut opens the app with a prefilled editor; user confirms. Revisit background writes only once the PendingMutation queue is robust.

## 8. Feature requests

- Add native Vim keybindings inside the Mac app if feasible. Scope to explore: modal nav (h/j/k/l, gg/G) across task/event lists and sidebar; command-mode (`:`) reusing command palette; insert-mode bindings inside task title/notes editors (SwiftUI `TextEditor` lacks native Vim — evaluate AppKit `NSTextView` subclass or integrating a mode engine). Confirm no collision with existing Cmd-shortcuts and system accessibility.

## 9. Deferred work

Not in scope for this push, listed here so nothing is lost:
- Offline `PendingMutation` queue (type exists in Models; writer/replayer not wired in Services).
- etag / `If-Match` conditional writes — etags are captured on read but not sent on write; currently last-write-wins vs. Google web UI.
- Calendar grid view (day/week/month).
- Task → calendar event time-blocking drag.
- Subtask hierarchy, task reorder, bulk operations, filters.
- RRULE editing, attendees / guest-email policy, "this and following" delete.
- Crash reporting.
- SQLite migration for the local cache.
- Native markdown editor for task notes and event descriptions.
  - Google Tasks `notes` is plain text on the wire — markdown rendering is purely client-side; store the raw markdown as the note body.
  - Google Calendar event `description` accepts a limited HTML subset (links, `<b>`, `<i>`, `<u>`, `<br>`, `<ul>`/`<ol>`/`<li>`). Transpile markdown → that HTML subset on write, and parse HTML → markdown on read so the Calendar web UI keeps rendering rich descriptions while our Mac UI shows native markdown editing.
  - Preserve a raw-html fallback for event descriptions that contain unsupported tags so we do not destroy formatting authored elsewhere.
