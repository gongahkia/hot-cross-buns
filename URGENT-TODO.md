# URGENT-TODO

Active work remaining for Hot Cross Buns as a daily-driver Google Tasks / Calendar client. Ordered by what blocks shipping or what the next maintainer should pick up first.

Core invariant: Google Tasks + Google Calendar are the source of truth. Every feature below round-trips to Google or is explicitly local-only app config (keybindings, templates, themes, cache). Nothing invents a data field Google cannot see without a deliberate, documented notes-marker encoding.

Ranking principle:

1. **§1–§5** — setup + QA that block a shippable build. Cannot ship without these.
2. **§6** — in-repo power-user feature work, ranked in order of implementation.
3. **§7–§8** — perf / battery passes.
4. **§9** — deprioritized extended-interop work.
5. **§10** — cybersecurity hardening.
6. **§11** — least-priority: daily local backup (implement last).
7. **§12–§15** — status / history / known risks / done. Reference only.

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

### 3a. Undo the local-QA entitlements workaround before shipping

During live QA on a machine without an Apple Developer team, `make run` / `make build` were pointed at a stripped-down **`HotCrossBuns-Dev.entitlements`** (network client only, **sandbox disabled**) so GoogleSignIn's Keychain write wouldn't fail. Ad-hoc signed + sandboxed builds hit `GIDSignIn Code=-2 "keychain error"` because the team-prefix access group expansion needs a real provisioning profile.

Before cutting a production DMG:

- Restore `CODE_SIGN_ENTITLEMENTS` in the `Makefile` back to `HotCrossBuns/Support/HotCrossBuns.entitlements` (or remove the override so Xcode's default from `project.yml` applies).
- Re-add the two entitlements that were stripped from `HotCrossBuns.entitlements` during local QA:
  - `com.apple.security.application-groups` → `group.com.gongahkia.hotcrossbuns` (Share Extension ↔ main app handoff)
  - `keychain-access-groups` → `$(AppIdentifierPrefix)com.gongahkia.hotcrossbuns.mac` (proper Keychain scope once we have a team ID)
- Re-add the matching `application-groups` to `HotCrossBunsShareExtension.entitlements`.
- Delete `HotCrossBuns/Support/HotCrossBuns-Dev.entitlements` after confirming the prod build signs cleanly with the Developer ID cert.
- Verify sign-in still works on a release build (the GoogleSignIn Keychain path should then succeed because the team-prefixed access group resolves against the real provisioning profile).

### 3b. Clean up Google Cloud project after QA

Post-QA / before handing off to other users, revisit <https://console.cloud.google.com/auth/clients>:

- Audit the existing OAuth client for unused redirect URIs / platforms.
- Decide whether to keep the app in **Testing** mode (caps at ~100 test users, no verification needed) or submit for **Production** verification (required for any public distribution — Google reviews the scopes).
- If multiple throwaway clients were created during QA, delete the unused ones so the Credentials list stays clean.
- Confirm the enabled APIs list is still just **Tasks API** + **Calendar API** — nothing else should have been enabled accidentally.

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

## 6. Power-user feature work (ranked)

In-repo feature work targeting developers + Obsidian/Notion crowd. Implement top-to-bottom. Every item must preserve the Google-is-SoT invariant: no new data fields that don't round-trip to Google (via native attributes or notes-marker encoding), no parallel local stores masquerading as canonical data.

**Status: §6.1–§6.13 all shipped.** Commits:

- §6.1 configurable view visibility — `ac0556a`
- §6.2 query DSL — `ac0556a`
- §6.3 URL-scheme deep links — `ac0556a`
- §6.4 bulk-select + client-batched actions — `de8be1c`
- §6.5 kanban view — `95fde2b`
- §6.6 timeline / Gantt view — `82e18a8`
- §6.7 quick switcher + palette split + week-timed drag-to-create — `9ac4b6b`
- §6.8 advanced search (regex + field operators) — `3c0e6ba`
- §6.9 leader-key chord bindings + which-key HUD — `1c87844`
- §6.10 pinned filters on menu-bar popover — `c1885a6`
- §6.11 per-surface font picker (infra + markdown editor wired) — `612853d`
- §6.12 passphrase-gated local cache encryption — `da33498`
- §6.13 task templates with variable expansion — `bc20880`

Ad-hoc additions shipped alongside §6 (not originally listed):

- Google Maps Embed full-view sheet for event locations — `8c43cb4`

Specs below kept for history + follow-up surface-wiring work.

### 6.1 Configurable view visibility (prereq for §6.5/§6.6) — shipped `ac0556a`

Users pick which sidebar tabs appear, and which view-modes appear inside tabs that host multiple views (Calendar today; Store once §6.5 lands). Nothing is force-visible.

- **Sidebar tab visibility.** Settings → new "Layout" section: checkbox list of sidebar entries. Applies to existing tabs (Calendar, Store) and any added below. Persist in `@AppStorage` under a stable key. Default = all on. `MacSidebarShell` filters `SidebarItem.allCases` before rendering.
- **Calendar sub-view visibility.** Same Layout section: checkbox list of Calendar view modes (day / week / month; plus timeline once §6.6 ships). User hides what they don't use; the view-mode segmented control renders only enabled modes. Default = all on. If the currently-selected view gets disabled, fall back to the first enabled one.
- **Store sub-view visibility** (adds once §6.5 lands). Same pattern: list / kanban toggles.
- Keep existing keyboard shortcuts (`goToCalendar`/`goToStore`/`goToSettings`, view-mode shortcuts) functional even when the target tab/view is hidden — shortcut unhides and focuses, or no-ops. Decide during impl; no-op is simpler.

### 6.2 Query-language sidebar items — shipped `ac0556a`

Extend `CustomFilterDefinition` with a text-DSL mode alongside the existing structured form.

- Grammar (suggested, refine on impl): `list:"Work" AND (tag:deep OR tag:focus) AND due<+7d AND -star AND -completed`. Operators: `AND`, `OR`, `NOT`/`-`, parens. Fields: `list`, `tag`, `star`, `completed`, `due` (`<`, `>`, `=`, relative `+Nd`/`-Nd` and absolute `YYYY-MM-DD`), `title` (substring / fuzzy).
- Saved queries pin to sidebar like current custom filters. Reuse `CustomFiltersSection` UI; add a "Query" tab in the editor sheet.
- Parser + evaluator unit-tested against `TaskMirror` fixtures. Pure read-side over existing mirror — no Google data writes.
- Error surfaces in-place (red underline + message) without crashing the sidebar.

### 6.3 URL-scheme deep links — shipped `ac0556a`

Register `hotcrossbuns://` scheme. Pure routing — every mutation still goes through existing Google flows.

- `hotcrossbuns://task/<id>` → open task in inspector (switch sidebar → Store → focus task).
- `hotcrossbuns://event/<id>` → open event in calendar.
- `hotcrossbuns://new/task?title=&notes=&due=&list=&tags=` → open QuickAdd prefilled.
- `hotcrossbuns://new/event?title=&start=&end=&location=&calendar=` → open QuickAddEventView prefilled.
- `hotcrossbuns://search?q=` → open command palette with query prefilled.
- Handle via `NSAppleEventManager` or SwiftUI `.onOpenURL`. Route through `RouterPath`.
- Unknown hosts / malformed params → silent no-op or toast; never crash.

### 6.4 Bulk-select + client-batched bulk actions — shipped `de8be1c`

Tasks already lag events on this — `EventBulkActionBar` exists, tasks don't. Add parity, then layer client-side batching so we don't hammer Google.

- `TasksView` gains multi-select (Cmd-click, Shift-click range). Selection state lives in the view model, not `TaskMirror`.
- Bulk action bar: complete / reopen, reschedule (relative + absolute), move list, add/remove tag (edits title's `#tag` tokens), star/unstar, delete.
- **Client-side optimizer before dispatch:**
  - Coalesce no-ops (e.g. completing an already-completed task is dropped).
  - Dedup redundant ops on the same id (last-write-wins within the batch).
  - Group by endpoint + method so we can use Google's batch endpoints where they exist (`tasks.batch`, Calendar events don't have a batch endpoint — serialize with throttle).
  - Respect Google's documented per-user-per-100s quotas: throttle via a token bucket in `OptimisticWriter` / `SyncScheduler`.
  - On partial failure, surface per-item status in the undo toast; retry only the failed subset.
- Route through existing `OptimisticWriter` so offline queue + etag conflict paths still apply.

### 6.5 Kanban view (opt-in, not forced) — shipped `95fde2b`

A different lens on Google Tasks. Columns are **Google-native or derivable only** — no invented status/priority fields.

- Placement: **view-mode toggle inside the Store tab** (decided). User can hide the Kanban mode via §6.1 Store sub-view visibility setting. No new sidebar tab.
- Column-grouping modes (all round-trip or derive cleanly):
  - By **list** (native).
  - By **due bucket** (overdue / today / this week / later / no-date — derived).
  - By **star** (starred / not).
  - By **tag** (from `#tag` extraction in title — round-trips as plain text).
- Drag between columns = real Google mutation (change list / change due / toggle star / edit title to swap tag). No local-only "status" column.
- Respects current sidebar filter / saved query if one is selected.

### 6.6 Timeline / Gantt view (opt-in, not forced) — shipped `82e18a8`

Time-axis lens on tasks + events.

- Placement: **view-mode toggle inside the Calendar tab** (decided), alongside day / week / month. User can hide the Timeline mode via §6.1 Calendar sub-view visibility setting. No new sidebar tab.
- Horizontal time axis, one row per task / event. Tasks with `dueDate` render as points or short bars; events render as spans using `start`/`end`.
- Dependency arrows: rendered only if `TaskDependencyMarkers` already round-trips via notes-field encoding. Verify on pickup; if not, drop arrows rather than invent local-only dep links.
- Drag-to-reschedule: task drag writes `dueDate`, event drag writes `start`/`end`. Existing reschedule paths.
- Zoom levels: day / week / month / quarter.

### 6.7 Quick-switcher + command-palette split — shipped `9ac4b6b`

Today `CommandPaletteView` mixes two distinct jobs in one list: running commands **and** finding task/event entities. Split them — the palette becomes a strict action launcher, a new quick-switcher owns entity navigation. Dedup the behavior so each surface has one purpose.

- **Command palette (`⇧⌘P`, unchanged hotkey):** commands only. New Task, New Event, Refresh, Force Resync, Print Today, Export Day/Week ICS, Switch Tab, Open Settings, Open Help, Insert Template (§6.13), and any future command. No task/event rows. `CommandPaletteView` keeps its Alfred-style empty-when-blank behavior.
- **Quick switcher (`⌘O`, new — decided):** entities only. Fuzzy-match against task titles, event titles, task lists, calendars, and saved-query names (§6.2). Enter → open/navigate; `⌘↩` → open in a new inspector column or focused window where applicable. Narrower UI than the palette; optimized for muscle-memory "go to X".
- **Migration:** move `CommandPaletteView`'s task/event/result rows into a new `QuickSwitcherView`. Palette loses the `onSelectTask` / `onSelectEvent` callbacks entirely.
- **Shared infra:** factor fuzzy scoring + recent-items + keyboard nav into a common `FuzzySearcher` used by both. Avoids divergent ranking.
- Advanced search operators (§6.8) are hosted inside the quick switcher — the palette has no search field after this split.
- Mental model: palette = "do", switcher = "go". Both reachable from the same `⌘`-family gesture space.

### 6.8 Advanced search — shipped `3c0e6ba`

Hosted in the quick switcher (§6.7). Extends beyond plain title substring.

- Field operators: `attendee:`, `duration>30m`, `has:notes`, `has:location`, `list:`, `calendar:`, `tag:`, `due<+7d`, `starts>=today`.
- Full-text across title + notes + location + attendees.
- Regex mode (toggle or leading `/…/`).
- Fuzzy fallback on plain-text queries.
- Results still just point at the mirror — all opens/edits go through normal Google paths.

### 6.9 Leader-key chord bindings — shipped `1c87844`

Leader-key chord bindings alongside existing single-shortcut `KeybindingsSection`.

- Leader key: `⌘K` (fixed in v1; configurable TBD).
- Chord sequences like `<leader>tn` = new task, `<leader>cp` = command palette, `<leader>gs` = go to store.
- Storage: extend `HCBShortcutStorage` JSON to support a `chord: ["⌘K", "t", "n"]` form alongside the existing single-key form.
- HUD: on leader press, show an overlay listing available next-keys (which-key-style).
- Does not replace single-shortcut bindings — they coexist.

### 6.10 Pinned filters on menu-bar extra popover — shipped `c1885a6`

Menu-bar popover currently shows quick-add + recent. Add user-pinned custom filters / saved queries for quick-glance.

- Users mark a filter / saved query (§6.2) as "pin to menu bar" in its editor.
- Popover renders pinned filters as sections with count badges + first N matches inline.
- Click a filter row → opens main app focused on that filter.
- No new data model — just a `pinnedToMenuBar: Bool` on `CustomFilterDefinition`. Local-only, app config.

### 6.11 Per-surface font picker — shipped `612853d` (infra + markdown editor wired; other surfaces still need retrofit)

Current `HCBAppearance` has a global font-size input. Extend to per-surface typeface choice.

- Surfaces: editor (markdown), sidebar, calendar grid, task list, inspector, menu bar popover.
- Each surface: font family + size + weight.
- Storage: `@AppStorage`-backed struct keyed by surface.
- Fall-through: unset surfaces inherit a global default (current behavior).
- Respect the existing "preserve system font design" carve-outs noted in §14.

### 6.12 Encrypted local cache — shipped `da33498`

Optional passphrase-gated encryption of the JSON snapshot cache and offline mutation queue.

- Off by default (no regression for existing users).
- When enabled: user sets passphrase → key derived via PBKDF2 / Argon2 → cache written with AES-GCM. Passphrase cached in Keychain for the session with user-configurable lock timeout.
- On launch: if encryption enabled and Keychain missing entry → show unlock sheet blocking app content.
- Wipe on repeated wrong passphrases? No — just stay locked.
- Google tokens already live in Keychain; this covers the offline cache only.

### 6.13 Templates with variables (client-only, must NOT leak to Google) — shipped `bc20880` (task templates; event templates still pending)

Named templates that expand into real Google tasks/events at instantiation.

- Template definitions stored **locally only** (`~/Library/Application Support/HotCrossBuns/templates/*.json`). They are app config, not data — same tier as keybindings.
- Variables: `{{today}}`, `{{tomorrow}}`, `{{+Nd}}`, `{{-Nd}}`, `{{nextWeekday:mon}}`, `{{cursor}}`, `{{clipboard}}`, `{{prompt:Label}}`.
- Fields templatable: title, notes/description, due/start/end, list, calendar, tags (via title `#tag` tokens), attendees, reminders, recurrence rule.
- Instantiation flow: palette → "Insert template…" → pick → prompt for `{{prompt:…}}` vars → produces a real Google Task/Event via existing write path.
- **Hard constraints:**
  - No template metadata ever lands in task/event notes/descriptions. The instantiated entry must be indistinguishable on google.com from a manually-created one.
  - No "template id" stored in `extendedProperties` — cross-client fragile and leaks implementation.
  - Corruption risk: write templates to a throwaway dir first, test instantiation in a dry-run mode that renders the resulting Google payload for the user to inspect before first real use.

### 6.14 Scrollable month navigation — pending

Make `MonthGridView` respond to vertical scroll so users move through time without hunting for the `◀ ▶` chevrons.

- Scroll down → advance to the next month; scroll up → previous month.
- Throttle: a single gesture steps one month per "significant" scroll, not one per pixel. Accumulate scroll delta and fire when it crosses a threshold.
- Trackpad + mouse-wheel both work; keyboard arrows continue to scroll the visible grid contents, not shift the month.
- Animation: transition between months should read as a month swap, not a scroll. Pin the weekday header; crossfade or slide the day grid rows.
- Must not break drag-to-create across days (the existing `DragGesture` on the grid) — scroll gesture needs a higher threshold so it doesn't trigger mid-drag.
- Acceptable to scope to Month view only for v1; Week/Day already have `◀ ▶` buttons that feel natural.

### 6.15 Vim keybind removal sweep — shipped (this commit)

Re-verified nothing has crept back in since `4674f8a`:

- `Features/Vim/` directory is absent.
- No `VimHud` / `VimKeyboardMonitor` / `VimTranslator` / `VimAction` /
  `vimContextHandler` / `isVimDetailFocused` references in any live file.
- Scrubbed two stale doc comments that referenced "Vim / VS Code style"
  in `HCBChord.swift` and `MacSidebarShell.swift` — pure comment changes,
  no behaviour impact.
- Updated §6.9 spec text to drop the vim-mode leader reference — chord
  feature ships with `⌘K` only.

Result: `grep -r vim .` on the repo returns only this historical record
+ commit-message references. No live code or copy remains.

## 7.01 Visual reference

Take visual and UI-specific reference (screenshots and actual behaviour) from contemporaries like Omnifocus 4, Ticktick, Things3, Apple Calendar, Sorted 3, Notion and Todoist

## 7.02. Performance optimisation and RAM / memory usage

Placeholder — scope during pickup. Likely includes: lazy-loading grid cells, image caching for location previews, reducing `AppModel` observable republishing, profiling `CalendarMirror` growth with large event counts.

## 8. Battery optimisation

Ensure foreground polling + background refresh don't drain battery. Includes: respecting `NetworkMonitor` low-power mode, throttling polling when window unfocused, suspending calendar grid animations off-screen, checking Spotlight indexer load.

## 9. Deprioritized extended interop

Implement only after §6 and §7/§8. Order within this section flexible.

### 9.1 Multi-format import / export

Readers + writers beyond the existing ICS path. All imports create real Google Tasks/Events; all exports are read-only snapshots. No parallel local store.

- **Readers:** Things 3 (SQLite db or JSON export), Todoist (JSON/CSV API export), Apple Reminders (EventKit), OmniFocus (OFOCUS archive or taskpaper export), TaskPaper (plain text), org-mode (plain text + PROPERTIES), Microsoft To Do, Google Keep lists.
- **Writers:** Markdown (per-task and digest), TaskPaper, org-mode, OPML, CSV, JSON.
- Progress UI for long imports with per-item failure reporting.
- Dedup on re-import (same as ICS flow).

### 9.2 Optional CLI surface (`hcb`)

Thin CLI that talks to the running app via local IPC (Unix socket or XPC) — does not open a second Google session. Commands: `add`, `list`, `complete`, `search`, `agenda`, `open <id>`. Read paths query the mirror; write paths dispatch through the same `OptimisticWriter`.

### 9.3 MCP servers for AI agent integration

Expose the mirror + mutation surface as an MCP server so external AI agents (Claude Desktop, others) can read tasks/events and propose changes. Every write still flows through the confirmation-gated path in §9.4. No background agent writes to Google without user approval.

### 9.4 Optional BYOK AI manager

User supplies their own API key (Anthropic / OpenAI). Natural-language input + image upload. Every interpreted action is presented as a diff-style confirmation before any Google write. Never auto-executes. Never stores API keys in plaintext — Keychain only. Deprioritized because it's additive, not blocking.

## 10. Cybersecurity hardening

End-to-end pass. Not a single item — schedule as its own focused push.

- Audit all inputs to `NaturalLanguageTaskParser` / `NaturalLanguageEventParser` / palette for injection vectors.
- Confirm URL-scheme handler (§6.3) strictly validates query params and rejects unexpected hosts/paths.
- Review `hotcrossbuns://` and Share Extension handoff for data exfil via crafted payloads.
- Verify all Google API responses are decoded against strict Codable schemas; no eval-style paths.
- Confirm no plaintext secrets in logs or crash reports (`CrashReporter`, `SystemCrashReportReader`).
- Verify Keychain access groups are correctly scoped post-§3a.
- Dependency vulnerability scan on SwiftPM graph (GoogleSignIn, Sparkle, etc.).

## 11. Daily local backup (least priority — implement last)

Defensive copy. Only exists for the case where Google loses user data on both surfaces (web + HCB cache). Not a sync target. Not a SoT.

- Off by default. Settings toggle + interval picker (off / daily / every N hours / on-launch only).
- Storage location: user-configurable, default `~/Library/Application Support/HotCrossBuns/backups/` with day-stamped files. User can redirect to iCloud Drive / external disk.
- Retention: user-configurable (keep last N / keep N days). Default: keep last 14.
- **Schema priorities:**
  1. **Storage-compact.** Must stay small with thousands of events + tasks. Use a binary-ish layout: MessagePack or CBOR top-level, per-record field interning for repeated strings (list IDs, calendar IDs, tag names), varint timestamps, gzip the outer file. Target <1MB per 10k entries before compression.
  2. **Round-trippable to JSON / the §9.1 export formats.** Ship a transpiler: `backup.hcbpack → JSON/Markdown/OPML/org/CSV`. Transpilation is a nice-to-have, not a hot path.
  3. **Versioned.** Include a schema-version header; refuse to load unknown-version files rather than silently mis-decode.
- Restore path: explicit user action in Diagnostics → "Restore from backup…". Never auto-restores on launch. Restore = diff against current mirror, preview, then write missing entries to Google (so backup → Google, not backup → local SoT).
- Custom schema is acceptable here **only because** it never leaves the local device and never substitutes for Google as SoT. If Google is reachable and has newer data, Google wins.

## 12. Carve-outs explicitly deferred (not in scope)

Previously considered, deliberately not implemented.

- **`⌘\` task drawer alternate binding.** `⌘J` already handles the same action; second shortcut is redundant.
- **Drag-out event tile to Finder.** Shipped "Export .ics…" right-click entry instead. Combining `.draggable(DraggedEvent)` with a file-drag conflicts with the reschedule-drag gesture. Revisit with a modifier-key gate if users ask.
- **Cross-calendar series-split.** See §13 "This and following" — scope too big to fold in previously.

## 13. Deferred roadmap

Not actively scheduled. Each is substantial enough to be its own focused push.

- ~~**"This and following" recurring-event edit**~~ — deliberately NOT implemented. Users rarely check past events; the cheaper fix shipped in 8698bfe: flag "Every event in the series" as destructive with copy that explicitly names the retroactive effect, and point users at Delete → This and following + re-create as the workaround. Reopen only if a real user complains about past-event mutation in practice.
- ~~**Cross-calendar drag for recurring `thisAndFollowing` scope**~~ — not needed. Move dialog's "Every event in the series" now carries the same retroactive warning as edit/delete.
- **Push-via-APNs relay** — requires a server, violates "Google is the backend" principle. Reconsider only if foreground polling proves inadequate in practice.
- **Rich metadata in Calendar private extended properties** — cross-client fragility; app-only annotations would disappear outside Hot Cross Buns.
- **SQLite migration for the local cache** — current JSON snapshot is adequate for one user's data volume. Reconsider if the cache grows past ~50MB or needs indexed queries.
- **Windows / Linux / Android ports** — out of scope by product decision.

## 14. Known residual risks

Low-severity items the audits surfaced that we haven't fixed. None are data-loss risks; each is either a narrow edge case, a latent bug that's not currently hit, or a behaviour gap that only matters if you notice it.

- **Single-occurrence recurring-event PATCH may need `originalStartTime`.** (`Services/Google/GoogleCalendarClient.swift` `updateEvent`.) When `scope == .thisOccurrence` and the event ID has the instance-suffix form `_<yyyymmddThhmmssZ>`, we currently assume Google's API infers the occurrence from the ID alone. If that's wrong, PATCH promotes the edit to the whole series — silent data mutation. **Verified only by §5 step 15 during live QA.** If that test fails, add an optional `originalStartTime: GoogleEventMutationDateDTO?` to the mutation DTO (mirroring the `start` encoding) and populate it from `event.startDate` for single-occurrence PATCHes on instance IDs.
- **Tasks watermark could be derived from the Google response `Date` header** rather than local time. Today a 300s local-clock slack covers most drift (widened from 60s in 906a7f2). Follow-up only — not a real bug, just a correctness upgrade over an already-safe default.

Fixed since the last audit pass:

- ~~`LocalNotificationScheduler.add(_:)` silently swallows scheduling errors~~ — 8ddb989 surfaces failures in `NotificationScheduleSummary` and Diagnostics.
- ~~Google Calendar's default reminder isn't honoured as a local notification~~ — c8b0393 decodes `defaultReminders`, carries a `usedDefaultReminders` flag on event mirrors, merges at `AppModel.upsert`, and makes the scheduler respect `event.reminderMinutes.first` instead of hard-coding -15 min.
- ~~`ICSDateParser` DateFormatter is shared across calls with per-call mutation of `.timeZone`~~ — d4e1346 builds a fresh formatter per call.
- ~~Tasks `updatedMin` watermark has a 60-second slack~~ — 906a7f2 widens to 300s via a named constant; the stronger "derive from response Date header" form is listed above as a follow-up.

## 15. Appearance — done

Phase 1 added the env infrastructure; Phase 2 migrated 508 call sites across 29 files.

- `.font(.X)` / `.font(.X.weight(.Y))` → `.hcbFont(.X)` / `.hcbFont(.X, weight: .Y)`
- `.font(.system(size: N, weight: .W, design: .D))` → `.hcbFontSystem(size: N, weight: .W, design: .D)`
- `.padding(N)` / `.padding(.edge, N)` → `.hcbScaledPadding(...)`
- `.frame(width/height: N)` and min/ideal/max variants → `.hcbScaledFrame(...)`

Intentionally left alone: `.font(.body.monospaced())`, `.font(.caption.monospacedDigit())`, `.font(.system(.largeTitle, design: .serif))`, etc. These rely on system-font design variants that SwiftUI's `Font.custom` can't reproduce — preserving system font here is by design.

Also left alone: native `.alert` / `.confirmationDialog` / `NSSavePanel`. AppKit-drawn, can't be scaled by SwiftUI; they follow macOS display settings.
