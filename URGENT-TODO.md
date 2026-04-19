# URGENT-TODO

Active work remaining for Hot Cross Buns as a daily-driver Google Tasks / Calendar client. Items are either out-of-repo setup the maintainer has to do themselves (§1–§3), on-device verification (§4–§5), in-repo feature work that elevates the app beyond MVP (§6), deferred roadmap that isn't scheduled but isn't forgotten (§7), or known residual risks to watch for in daily use (§8).

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

## 4. Single-window + 2-tab sidebar on-device verification

On-device checks still outstanding:

- `open build/apple/DerivedData/Build/Products/Debug/HotCrossBunsMac.app` twice in a row — second launch should just foreground the existing window, not create a new one.
- Cmd+N invokes "New Task" (our override), not "New Window".
- Sidebar lists Calendar / Store and renders badges for Calendar (today's event count) and Store (open task count).
- Cmd+, opens the dedicated Settings window (separate scene).
- Cmd+Shift+P opens the "Print Today" sheet.

## 5. Live product QA

Dogfood with a real account for at least one workday on macOS. Smoke checklist:

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
15. **Recurring event single-occurrence edit (originalStartTime check).** Pick a weekly recurring event. Edit only one occurrence — change the title or time, pick "This event only" (not all-in-series). Open Google Calendar's web UI and confirm **only that occurrence changed**; the other instances of the series are untouched. If the whole series was modified instead, `GoogleEventMutationDTO` needs an `originalStartTime` field populated from the instance's start when PATCHing an instance ID. Current code assumes Google handles this automatically based on the instance-ID suffix; this check verifies that assumption against real Google behaviour.
16. **Share Extension round-trip.** In Safari, pick a web page → Share → Hot Cross Buns. App should foreground and open QuickAdd with the page URL prefilled. If the extension doesn't appear in Safari's Share menu, log out/in (or Finder → kill and relaunch) — macOS is finicky about picking up new share extensions on first install.
17. **Services menu round-trip.** Select text anywhere (TextEdit, a web page) → right-click → Services → "Create Hot Cross Buns task". App should foreground and open QuickAdd with the selection prefilled.
18. **.ics drop.** Export a Google Calendar to `.ics` (Settings → Import/Export) and drag onto the Calendar view. Should create events on the first writable calendar. Drop the same file a second time — alert should say "skipped N duplicates, imported 0".

## 6. Next in-repo feature work

Tiers 1, 2, 3, and 4 are all complete. Tier 1/2 observability + fault tolerance shipped in e2b7edc → a2d2a8a; Tier 3 UX polish shipped through eaf663c; Tier 4 net-new product features shipped through 216581f.

Nothing scheduled in this section. Next-up work lives in §5 (live QA) and §7 (deferred roadmap). When picking up from here, prefer to resolve items in §5 or §8 before adding new feature scope.

Carve-outs that were explicitly deferred rather than implemented:

- **`⌘\` task drawer alternate binding.** Skipped — `⌘J` already handles the same action, adding `⌘\` as a second shortcut is redundant.
- **Drag-out event tile to Finder.** Spec mentioned this under Tier 4 #14; we shipped a "Export .ics…" right-click entry instead, because combining `.draggable(DraggedEvent)` with a separate file-drag exports conflicted with the existing reschedule-drag gesture. Worth revisiting with a modifier-key gate if users ask.
- **Cross-calendar series-split.** See §7 "This and following" — scope too big to fold into Tier 4.

## 7. Deferred roadmap

Not actively in scope but worth implementing eventually. Each is substantial enough that it should be its own focused push.

- **"This and following" recurring-event edit** — mirror of the delete scope that shipped in `a046517`, but harder. Requires a genuine series-split: truncate the old master with `UNTIL`, insert a new master at the cutoff with the edited content and rules, then propagate any per-instance exceptions in the post-cutoff window against the new master's timebase. Partial-failure rollback is non-trivial (if truncate succeeds and insert fails, the original series is already truncated with no replacement — needs to PATCH the master back to its original recurrence, so we must snapshot the pre-truncate state). Attendee RSVPs reset since the new series gets a fresh event ID. Scheduled local reminders + Spotlight entries keyed to the old instance IDs become orphans and must be rebuilt. Offline queue would need a new `PendingEventSeriesSplitPayload` that encodes both HTTP operations plus the rollback snapshot. Realistic cost: 1–2 days of focused work. Workaround until this lands: edit the master directly (affects past instances too) or delete "this and following" then create a new series from scratch.
- **Cross-calendar drag for recurring `thisAndFollowing` scope** — blocked by the series-split work above. Dragging a recurring event onto another calendar currently offers "This event only" or "All events in series"; no middle option.
- **Multi-account (personal + work)** — one `GoogleAccount` at a time today. Revisit after the calendar is solid for the single-account case.
- **Push-via-APNs relay** — requires a server, violates "Google is the backend" principle. Reconsider only if foreground polling proves inadequate in practice.
- **Rich metadata in Calendar private extended properties** — cross-client fragility; app-only annotations would disappear outside Hot Cross Buns.
- **SQLite migration for the local cache** — current JSON snapshot is adequate for one user's data volume. Reconsider if the cache grows past ~50MB or needs indexed queries.
- **Windows / Linux / Android ports** — out of scope by product decision.

## 8. Known residual risks

Low-severity items the audits surfaced that we haven't fixed. None are data-loss risks; each is either a narrow edge case, a latent bug that's not currently hit, or a behaviour gap that only matters if you notice it. Listed here so they don't get forgotten if you do.

- **Single-occurrence recurring-event PATCH may need `originalStartTime`.** (`Services/Google/GoogleCalendarClient.swift` `updateEvent`.) When `scope == .thisOccurrence` and the event ID has the instance-suffix form `_<yyyymmddThhmmssZ>`, we currently assume Google's API infers the occurrence from the ID alone. If that's wrong, PATCH promotes the edit to the whole series — silent data mutation. **Verified only by §5 step 15 during live QA.** If that test fails, add an optional `originalStartTime: GoogleEventMutationDateDTO?` to the mutation DTO (mirroring the `start` encoding) and populate it from `event.startDate` for single-occurrence PATCHes on instance IDs.
- **Tasks watermark could be derived from the Google response `Date` header** rather than local time. Today a 300s local-clock slack covers most drift (widened from 60s in 906a7f2). Follow-up only — not a real bug, just a correctness upgrade over an already-safe default.

Fixed since the last audit pass:

- ~~`LocalNotificationScheduler.add(_:)` silently swallows scheduling errors~~ — 8ddb989 surfaces failures in `NotificationScheduleSummary` and Diagnostics.
- ~~Google Calendar's default reminder isn't honoured as a local notification~~ — c8b0393 decodes `defaultReminders`, carries a `usedDefaultReminders` flag on event mirrors, merges at `AppModel.upsert`, and makes the scheduler respect `event.reminderMinutes.first` instead of hard-coding -15 min.
- ~~`ICSDateParser` DateFormatter is shared across calls with per-call mutation of `.timeZone`~~ — d4e1346 builds a fresh formatter per call.
- ~~Tasks `updatedMin` watermark has a 60-second slack~~ — 906a7f2 widens to 300s via a named constant; the stronger "derive from response Date header" form is listed above as a follow-up.
