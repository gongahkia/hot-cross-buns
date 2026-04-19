# URGENT-TODO

Outstanding items for Hot Cross Buns as a daily-driver Google Tasks/Calendar client. The out-of-repo blockers (§1–§3) must be done by the maintainer; the in-repo feature work (§7) is scoped against what's needed to fully replace the Google Calendar web UI for personal use.

## 1. Google OAuth wiring

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

## 2. Sparkle auto-update provisioning

`SUPublicEDKey` is still missing from `apps/apple/HotCrossBuns/Support/Info-macOS.plist`. Sparkle will refuse updates without it.

- Run Sparkle's `generate_keys` (bundled in the SwiftPM package's derived-data directory, or downloadable from the Sparkle GitHub release) once per machine.
- Paste the **public** key into `Info-macOS.plist` under `SUPublicEDKey` via a build setting or direct edit.
- Store the **private** key as GitHub Actions secret `SPARKLE_PRIVATE_KEY`.
- Enable GitHub Pages on the `gh-pages` branch so `https://gongahkia.github.io/hot-cross-buns/appcast.xml` serves.
- Confirm the first release publishes an appcast entry and that a previously installed build picks it up via in-app "Check for Updates".

See `docs/RELEASING.md` for the end-to-end flow.

## 3. Apple Developer ID + notarization

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

## 4. Confirm single-window + 2-tab sidebar on-device

Code changes already landed (`HotCrossBunsApp.swift` uses `Window("Hot Cross Buns", id: "main")` with `.windowResizability(.contentMinSize)`; `MacSidebarShell.swift` defaults `NavigationSplitViewVisibility.all`). On-device verification still outstanding.

- `open build/apple/DerivedData/Build/Products/Debug/HotCrossBunsMac.app` twice in a row — second launch should just foreground the existing window, not create a new one.
- Cmd+N invokes "New Task" (our override), not "New Window".
- Sidebar lists Calendar / Store and renders badges for Calendar (today's event count) and Store (open task count).
- Cmd+, opens the dedicated Settings window (separate scene).

## 5. Live product QA

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

## 6. Product decisions (locked)

- **Attendee emails**: ask every time via checkbox in the event editor, default off. Matches Google Calendar web behavior without surprising mass-emails.
- **Recurrence UI**: Daily/Weekly/Monthly/Yearly presets plus a "Custom…" expander (interval, weekday picker, end = never/on date/after N). No raw RRULE string; no natural-language parsing in v1.
- **Offline writes**: optimistic with temporary local IDs; task/event appears instantly marked "pending sync"; ID is remapped when Google accepts. Requires ID-remap handling in any relation (e.g. subtasks once added).
- **App Intents**: foreground handoff only — Shortcut opens the app with a prefilled editor; user confirms. Revisit background writes only once the PendingMutation queue is robust.

## 7. Next feature work

Prioritized for daily-driver use. Tier A items close productivity power-ups most users reach for daily; Tier B hardens what's already shipped; Tier C elevates the app beyond "web client pretending to be native."

### Tier A — productivity power-ups

1. **Bulk task selection** — `List(selection:)` multi-select in `StoreView` with toolbar actions "Complete all" / "Delete all" / "Move to list…".
2. **Clear completed tasks** (`tasks.clear` API) — Google Tasks batch endpoint that wipes completed from a list. Surface as a button in `StoreView` toolbar when the active filter is a single list.
3. **Undo for delete and edit** — generalise `UndoToast` / `recentlyCompletedTaskID` into an `UndoStack` that captures the inverse of any single mutation; expose for task delete, event delete, and inspector edits.
4. **In-Calendar event search** — searchable field in the `CalendarHomeView` toolbar that filters events rendered on the grid (distinct from the command palette, which navigates away).
5. **Month grid drag-to-reschedule** — `MonthGridView` should mirror `WeekGridView`'s `dropDestination(for: DraggedEvent.self)` to let users drag an event to a new day.
6. **Quick-add reads clipboard** — when Cmd+Shift+Space opens `QuickAddView`, if the clipboard contains URL-like or plain text content, pre-fill the title.
7. **"This and following" recurring delete** — Google Calendar web offers three options (this, this-and-following, all-in-series). We currently support only `.thisOccurrence` and `.allInSeries`; add the middle option with the corresponding Google Calendar API call pattern.

### Tier B — infrastructure / reliability

8. **Offline-queue test coverage** — the `PendingTaskUpdatePayload` / `replayTaskCompletion` / etc. paths shipped recently without unit tests. Add a mock-transport test harness that asserts HTTP verb + `If-Match` header + state transitions (transient retain, 412 drop-and-refresh, terminal revert).
9. **Cache schema versioning** — `CachedAppState` gets a `schemaVersion: Int` field with explicit migration shims. The current `LocalCacheStore.loadCachedState` fallback catches total decode failure but cannot migrate a renamed field; versioning prevents future silent data loss on upgrade.
10. **Diagnostics: per-mutation pending-queue clear** — `DiagnosticsView` should list queued mutations and allow per-item drop, for the case where one mutation keeps 412'ing and blocks replay.
11. **Token-refresh failure UX** — `GoogleSignInAccessTokenProvider.accessToken()` can throw. Distinguish "refresh failed, reconnect needed" (→ `authState = .failed`) from "transient network" (→ queue and retry). Currently the error is generic.
12. **Crash reporting** — no crash reporter wired. Lightweight file-based crash capture written to `~/Library/Application Support/...` on next launch, surfaced via `DiagnosticsView`.
13. **Sync scheduler backoff ceiling** — `BackoffPolicy.nearRealtime` retries indefinitely. On persistent failure (say, 30+ min of no network), cap retries and surface a visible "sync paused — check connection" state.

### Tier C — macOS-native polish

14. **Share Extension** — "Share to Hot Cross Buns" target from Safari / Mail to create a task or event with URL + selected text pre-filled.
15. **Services menu** — "Create Hot Cross Buns task from selection" anywhere the user highlights text system-wide.
16. **Spotlight QuickLook previews** — Spotlight indexing already exists; add a QuickLook provider so users can peek event details from Spotlight results without launching the app.
17. **Drag `.ics` file onto the app to import as event(s)** — parse and route through `createEvent` (with conflict detection).
18. **Print support** — `Exporters.swift` has markdown + ICS output; add a native Print sheet layout for today / week / selected task list.
19. **Localization scaffolding** — wrap user-visible strings in `LocalizedStringKey` now so future translations are cheap. English-only for v1.

## 8. Deferred (non-goals for now)

- Multi-account (personal + work) — large change, revisit after Tier 1–3.
- Push-via-APNs relay — requires a server, violates "Google is the backend" principle.
- Rich metadata in Calendar private extended properties — cross-client fragility.
- SQLite migration for the local cache (current JSON snapshot is adequate for the scale of one user's data).
- Windows / Linux / Android ports.
