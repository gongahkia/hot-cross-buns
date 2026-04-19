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

Tiers 1, 2, and 3 are complete (observability, fault tolerance, and UX polish shipped through commit eaf663c). Tier 4 (net-new product features) remains.

Residual Tier 3 carve-outs — small items deliberately deferred rather than solved because each would expand scope:

- `⌘F` to focus the Calendar in-grid search / the Store filter field. `.searchable` already wires ⌘F natively for Store's sidebar search; Calendar's `CalendarSearchField` in the toolbar needs an explicit `.searchable` adoption to pick up the system shortcut.
- `⇧⌘G` go-to-date picker in Calendar. Requires a new modal sheet + wiring; tracked as Tier 4 item 10.
- `⌘\` task drawer toggle alternate binding (Cmd+J already works). Skipped — redundant with existing shortcut.

### Tier 4 — net-new product features

Not required for daily-driver use, but each elevates the product above MVP. Pick à la carte.

1. **Natural-language in event creation.** We already parse "tmr 9am" / "#list" for tasks in `NaturalLanguageTaskParser`. Extend to events: `AddEventSheet` gains a top-level "Quick create" text field that parses "lunch with Bob tomorrow 1pm at Philz" into summary + start + end + location. Power-user entry path for events.
2. **Task snooze.** Right-click / context-menu entry in `StoreView` rows: "Snooze to tomorrow", "Snooze to next week", "Snooze until…". Updates `dueDate` without mutating other fields. Saves a lot of clicks vs opening the inspector.
3. **Day view mode in Calendar.** Agenda / Week / Month exists; a single-day hour-grid mode with the day's events full-width plus the day's tasks in a right panel. Fills the gap between Agenda (list-only) and Week (7-day grid).
4. **Event duplicate-with-offset.** `duplicateEvent` exists; add a submenu "Duplicate to next week / next month / +N days" that clones the event and shifts the dates. Useful for repeating monthly-ish events that don't fit an RRULE.
5. **Quick-peek previews.** Hover over a task row in `StoreView` or an event tile in the grid → popover showing details without navigating. Similar to macOS QuickLook's spacebar gesture.
6. **Event templates.** "Save as template" on any event → a named blueprint (summary, duration, reminders, attendees, description, colour). "New from template" picks one and opens `AddEventSheet` pre-filled. Power user time-blocking ergonomics.
7. **Multi-select in Calendar.** Cmd-click events in Week / Month → toolbar actions: delete all, move to calendar, shift by offset. Mirror of the bulk-select work we did for Store.
8. **Task dependencies (blocks / blocked-by).** Encode via a dedicated private extended-property on the task notes block (since Google Tasks has no native dependency field). "Blocked" tasks show greyed-out in Store until their blocker is completed. Requires UX design for the link affordance.
9. **Recurring tasks (not just events).** Google Tasks API doesn't natively support recurrence the way Calendar does; we'd emulate it client-side: on complete, re-create with advanced dueDate (we partially do this already via `TaskRecurrenceMarkers`). Surface as a first-class "Repeat" control in `AddTaskSheet` / `EditTaskSheet`.
10. **Go-to-date.** `⇧⌘G` opens a date picker modal; calendar jumps to that date and Store's "Due Today" filter pivots to that date. Useful for scanning a specific upcoming day.
11. **Subtask drag-reorder.** Task hierarchy supports subtasks but reordering them requires the indent / outdent keyboard shortcut. Add drag-to-reorder within a parent's children, within a list.
12. **Week-at-a-glance summary in menu bar extra.** Current menu bar extra shows today. A new mode shows a compact 7-day forecast with events-per-day counts. Configurable toggle.
13. **Apple Reminders import.** One-time migration button in Settings: read the user's Reminders app lists (requires EventKit permission), import each as a task list + tasks. One-shot, no ongoing sync.
14. **ICS export per selection.** `Exporters.swift` has `EventMarkdownExporter`; add `EventICSExporter` that emits an `.ics` file for a single event, a day, or a week. Drag-out target on event tiles.

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

- **`LocalNotificationScheduler.add(_:)` silently swallows scheduling errors.** (`Services/Notifications/LocalNotificationScheduler.swift:79` via `try?`.) If macOS rejects a specific reminder request (conflicting identifier, notifications-settings race), the failure is invisible. Partially mitigated: the H1 `NotificationScheduleSummary` in DiagnosticsView shows the scheduled-vs-expected counts, so a systemic problem would show as deferred != 0 despite `hasDeferred` being false. **Fix when hit:** propagate the error and count failures into the summary.
- **Google Calendar's default reminder isn't honoured as a local notification.** (`Services/Google/GoogleCalendarClient.swift` `GoogleEventRemindersDTO.customPopupMinutes`.) When `useDefault == true`, the decoded mirror has `reminderMinutes == []`, so events relying on Google's default (usually 10 min before) won't fire a local notification in this app. They still fire Google's own notifications via email/web. **Fix when hit:** fetch each calendar's `defaultReminders` at list time and merge into the event mirror when `useDefault == true`.
- **`ICSDateParser` DateFormatter is shared across calls with per-call mutation of `.timeZone`.** (`Services/ICS/ICSImporter.swift`.) Dormant because ICS import is serial today — `ICSImporter.parse` is called on a single Task from the drop handler. If a future caller parses concurrently, this is a data race. **Fix when hit:** build a fresh formatter per call, or use `TimeZone(identifier:)` resolution + a POSIX-locale formatter that takes the time zone as a parameter.
- **Tasks `updatedMin` watermark has a 60-second slack.** (`Services/Sync/SyncScheduler.swift`, `tasksUpdatedMin: syncStartedAt.addingTimeInterval(-60)`.) If the user's system clock drifts forward by >60s relative to Google's servers, tasks updated in that narrow window can be missed on the incremental sync until the next full sync runs. **Fix when hit:** widen the slack to ~5 minutes (costs a slightly larger incremental fetch but stays correct up to 5-minute clock drift), or derive the watermark from Google's `Date` response header instead of local time.
- **Single-occurrence recurring-event PATCH may need `originalStartTime`.** (`Services/Google/GoogleCalendarClient.swift` `updateEvent`.) When `scope == .thisOccurrence` and the event ID has the instance-suffix form `_<yyyymmddThhmmssZ>`, we currently assume Google's API infers the occurrence from the ID alone. If that's wrong, PATCH promotes the edit to the whole series — silent data mutation. **Verified only by §5 step 15 during live QA.** If that test fails, add an optional `originalStartTime: GoogleEventMutationDateDTO?` to the mutation DTO (mirroring the `start` encoding) and populate it from `event.startDate` for single-occurrence PATCHes on instance IDs.
