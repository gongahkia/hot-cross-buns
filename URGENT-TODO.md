# URGENT-TODO

Outstanding items from the Mac-only refactor push. Everything listed here is unblocking for a real release; feature-depth work (calendar grid, subtasks, recurrence, offline queue) is explicitly deferred.

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

# Reset only the CAS path that trips the save error; leave SPM cache alone.
xcodebuild -project HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS,arch=arm64' \
  clean

xcodebuild -project HotCrossBuns.xcodeproj \
  -scheme HotCrossBunsMac \
  -destination 'platform=macOS,arch=arm64' \
  test CODE_SIGNING_ALLOWED=NO | tee /tmp/hcb-test.log

# Pass criteria:
grep -E 'Executed [0-9]+ tests, with 0 failures' /tmp/hcb-test.log | wc -l
# Expect 5 (one per suite).
```

### If the result-bundle save error re-occurs
It's a sandboxing / CAS issue local to the Xcode 26 beta. Two workarounds, in order of cost:
1. Run tests with `-disableAutomaticPackageResolution -skipPackagePluginValidation` and redirect the result bundle: `-resultBundlePath "$PWD/build/apple/TestResults"`.
2. If still flaky, temporarily switch DerivedData off `/Users/...` (the default) to a path in `$PWD/build/apple/DerivedData`: pass `-derivedDataPath build/apple/DerivedData` to the same command.

### If a real test failure surfaces
Most likely suspect is `SyncSchedulerTombstonePurgeTests` — it uses a private `MergePurgeFixture` that re-implements the scheduler's post-merge filter. If `SyncScheduler.mergeTasks` / `mergeEvents` later change shape (sorting, recurrence handling), update the fixture to match. The real merge logic lives in `apps/apple/HotCrossBuns/Services/Sync/SyncScheduler.swift`.

## 2. Confirm the single-window + sidebar fix on-device

The user reported two app windows at once (Mission Control screenshot). Root cause: `WindowGroup` opens a new instance per cold launch / ⌘N.

Already changed `HotCrossBunsApp.swift` to `Window("Hot Cross Buns", id: "main")` with `.windowResizability(.contentMinSize)`, and `MacSidebarShell.swift` now defaults `NavigationSplitViewVisibility.all` so the sidebar shows even on the 900-minimum window width.

**Verify manually:**
- `open build/apple/DerivedData/Build/Products/Debug/HotCrossBunsMac.app` twice in a row — second launch should just foreground the existing window, not create a new one.
- ⌘N invokes "New Task" (our override), not "New Window".
- Sidebar lists Today / Tasks / Calendar / Search / Settings and renders badges for Today/Tasks counts.

## 3. Manual Google OAuth wiring (cannot be done from repo code alone)

Copy `apps/apple/Configuration/GoogleOAuth.example.xcconfig` to `GoogleOAuth.xcconfig` (already in `.gitignore`) and fill in:
```
GOOGLE_MACOS_CLIENT_ID = <client id>.apps.googleusercontent.com
GOOGLE_MACOS_REVERSED_CLIENT_ID = com.googleusercontent.apps.<reversed id>
```

Then in Xcode, attach that xcconfig to the `HotCrossBunsMac` target's Debug + Release configurations. Without this, `GoogleAuthService.isConfigured` returns false and sign-in is disabled.

Full checklist already in `to.do.md`.

## 4. Sparkle key provisioning

- Run Sparkle's `generate_keys` (bundled in the SwiftPM package's derived-data directory, or downloadable from the Sparkle GitHub release) once per machine.
- Paste the **public** key into `apps/apple/HotCrossBuns/Support/Info-macOS.plist` under `SUPublicEDKey` — currently missing; Sparkle will refuse updates without it.
- Store the **private** key as GitHub Actions secret `SPARKLE_PRIVATE_KEY`.
- Enable GitHub Pages on the `gh-pages` branch so `https://gongahkia.github.io/hot-cross-buns/appcast.xml` serves.

See `docs/RELEASING.md` for the end-to-end flow.

## 5. Developer ID + notarization secrets

GitHub Actions release workflow expects the following secrets (they do not exist yet):
- `MACOS_DEVELOPER_ID_P12_BASE64`
- `MACOS_DEVELOPER_ID_P12_PASSWORD`
- `MACOS_DEVELOPER_ID_APPLICATION`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APP_SPECIFIC_PASSWORD`
- `NOTARIZE_MACOS_DMG=1`

Without them, the release job still produces an unsigned DMG but Gatekeeper will warn on first open.

## 6. Post-verification smoke checklist (single-user, 10 minutes)

1. Sign in with real Google account via Settings → Google account → Connect Google.
2. Refresh; confirm task lists + calendars populate.
3. Create a task → confirm it appears in Google Tasks web UI.
4. Create an all-day event and a timed event → confirm they appear in Google Calendar web UI with the configured reminder.
5. Delete a task in the web UI; trigger Refresh in-app; verify the task disappears (tombstone purge working).
6. Toggle `Menu bar extra` off/on in Settings → confirm the menu bar icon hides/shows.
7. Toggle `Dock badge for overdue tasks` off → confirm badge clears.
8. Spotlight for a task title → confirm a result appears and clicking opens the task detail inside the app.
9. Sync menu → Check for Updates → confirm Sparkle dialog opens (will show "no updates" until an appcast entry is published).

## 7. Known deferred work

Not in scope for this push, listed here so nothing is lost:
- Offline `PendingMutation` queue (type exists; writer/replayer missing).
- etag / `If-Match` conditional writes — currently last-write-wins vs. Google web UI.
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
