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

All Tier A / B / C feature work is complete. Remaining items are either out-of-repo blockers (§1–§3), on-device verification (§4–§5), or deferred (§8).

## 8. Deferred (lower priority but on the roadmap)

Not actively in scope but worth implementing eventually. Each is substantial enough that it should be its own focused push.

- **"This and following" recurring-event edit** — mirror of the delete scope that shipped in `a046517`, but harder. Requires a genuine series-split: truncate the old master with `UNTIL`, insert a new master at the cutoff with the edited content and rules, then propagate any per-instance exceptions in the post-cutoff window against the new master's timebase. Partial-failure rollback is non-trivial (if truncate succeeds and insert fails, the original series is already truncated with no replacement — needs to PATCH the master back to its original recurrence, so we must snapshot the pre-truncate state). Attendee RSVPs reset since the new series gets a fresh event ID. Scheduled local reminders + Spotlight entries keyed to the old instance IDs become orphans and must be rebuilt. Offline queue would need a new `PendingEventSeriesSplitPayload` that encodes both HTTP operations plus the rollback snapshot. Realistic cost: 1–2 days of focused work. Workaround until this lands: edit the master directly (affects past instances too) or delete "this and following" then create a new series from scratch.
- **Cross-calendar drag for recurring `thisAndFollowing` scope** — blocked by the series-split work above. Dragging a recurring event onto another calendar currently offers "This event only" or "All events in series"; no middle option.
- **Multi-account (personal + work)** — one `GoogleAccount` at a time today. Revisit after the calendar is solid for the single-account case.
- **Push-via-APNs relay** — requires a server, violates "Google is the backend" principle. Reconsider only if foreground polling proves inadequate in practice.
- **Rich metadata in Calendar private extended properties** — cross-client fragility; app-only annotations would disappear outside Hot Cross Buns.
- **SQLite migration for the local cache** — current JSON snapshot is adequate for one user's data volume. Reconsider if the cache grows past ~50MB or needs indexed queries.
- **Windows / Linux / Android ports** — out of scope by product decision.
