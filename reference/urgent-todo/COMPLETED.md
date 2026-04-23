# COMPLETED

Shipped work — history / reference. Active work lives in `URGENT-TODO.md`.

## §6 Power-user feature work

All §6.1–§6.15 items shipped. Commits:

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
- §6.11 per-surface font picker (infra + all six surfaces wired) — `612853d` + retrofit follow-up
- §6.12 passphrase-gated local cache encryption — `da33498`
- §6.13 task templates with variable expansion — `bc20880`
- §6.13b event templates with variable expansion — follow-up
- §6.14 scroll-to-paginate month grid (+ directional slide polish) — `94e923c` + follow-up
- §6.15 vim keybind removal sweep — `4674f8a` + follow-up

Ad-hoc additions shipped alongside §6:

- Google Maps Embed full-view sheet for event locations — `8c43cb4`

### 6.1 Configurable view visibility — shipped `ac0556a`

Users pick which sidebar tabs appear, and which view-modes appear inside tabs that host multiple views. Settings → "Layout" section has sidebar + Calendar sub-view + Store sub-view checkbox lists. Default = all on. Keyboard shortcuts keep working even when the target tab/view is hidden (unhide + focus).

### 6.2 Query-language sidebar items — shipped `ac0556a`

`CustomFilterDefinition` supports a text-DSL mode alongside the structured form. Grammar covers `list`, `tag`, `star`, `completed`, `due`, `title` with `AND`/`OR`/`NOT`, parens, relative + absolute dates. Saved queries pin to sidebar; errors surface in-place. Parser + evaluator unit-tested.

### 6.3 URL-scheme deep links — shipped `ac0556a`

`hotcrossbuns://` scheme registered. Routes task, event, new/task, new/event, search through `RouterPath`. Unknown hosts / malformed params no-op silently.

### 6.4 Bulk-select + client-batched bulk actions — shipped `de8be1c`

`TasksView` multi-select (Cmd-click, Shift-click). Bulk bar: complete/reopen/reschedule/move-list/tag/star/delete. Client-side optimizer coalesces no-ops, dedups same-id ops, groups by endpoint, throttles via token bucket, surfaces per-item status on partial failure. Routes through `OptimisticWriter` for offline queue + etag parity.

### 6.5 Kanban view — shipped `95fde2b`

View-mode toggle inside the Store tab. Column-grouping modes: by list / due bucket / star / tag. Drag between columns dispatches a real Google mutation. Respects current sidebar filter / saved query.

### 6.6 Timeline / Gantt view — shipped `82e18a8`

View-mode toggle inside the Calendar tab. Horizontal time axis, tasks as points/bars, events as spans. Drag-to-reschedule writes dueDate / start-end. Zoom: day / week / month / quarter.

### 6.7 Quick-switcher + command-palette split — shipped `9ac4b6b`

Palette (`⇧⌘P`) is commands only. Quick switcher (`⌘O`) owns entity navigation with fuzzy match over tasks, events, task lists, calendars, saved queries. Shared `FuzzySearcher` infra. Mental model: palette = "do", switcher = "go".

### 6.8 Advanced search — shipped `3c0e6ba`

Hosted in the quick switcher. Field operators: `attendee:`, `duration>30m`, `has:notes`, `has:location`, `list:`, `calendar:`, `tag:`, `due<+7d`, `starts>=today`. Full-text across title + notes + location + attendees. Regex mode (toggle or leading `/…/`), fuzzy fallback on plain-text queries.

### 6.9 Leader-key chord bindings — shipped `1c87844`

Leader key `⌘K` (fixed in v1). Chord sequences via `HCBShortcutStorage` JSON. Which-key HUD overlays available next-keys on leader press. Coexists with single-shortcut bindings.

### 6.10 Pinned filters on menu-bar extra popover — shipped `c1885a6`

`pinnedToMenuBar: Bool` on `CustomFilterDefinition`. Popover renders pinned filters as sections with count badges + first N matches inline. Click opens main app focused on that filter.

### 6.11 Per-surface font picker — shipped `612853d` + retrofit follow-up

All six surfaces (editor, sidebar, calendar grid, task list, inspector, menu bar) honour per-surface font + size overrides via `.hcbSurface(_:)`. Layers onto existing `hcbFontFamily` / `hcbTextSizePoints` env keys so every nested `.hcbFont(.role)` call site picks up the override without per-call-site changes. Unset fields fall through to the global Appearance values; system-font carve-outs (§14) untouched.

### 6.12 Encrypted local cache — shipped `da33498`

Optional passphrase-gated encryption of the JSON snapshot cache and offline mutation queue. Off by default. PBKDF2 / Argon2 key derivation → AES-GCM at rest. Session passphrase cached in Keychain with configurable lock timeout. Unlock sheet blocks app content if Keychain entry is missing on launch. Google tokens continue to live in Keychain independently.

### 6.13 Templates with variable expansion — shipped `bc20880` (tasks) + follow-up (events)

Named templates expand into real Google tasks / events. Definitions stored locally in `AppSettings.taskTemplates` / `AppSettings.eventTemplates` (never written to Google). Shared variable set across both: `{{today}}`, `{{tomorrow}}`, `{{yesterday}}`, `{{+Nd/-Nd/w/m/y}}`, `{{nextWeekday:mon}}`, `{{cursor}}`, `{{clipboard}}`, `{{prompt:Label}}`. Unknown variables are left visible so typos don't silently drop values.

**§6.13b event templates** add fields: `dateAnchor` (YYYY-MM-DD template), `timeAnchor` (literal HH:mm; empty rounds up-now to the next 15m), `durationMinutes`, `isAllDay`, `location`, `attendees` (per-entry template), `reminderMinutes`, `recurrenceRule` (RRULE body — `RRULE:` auto-prefixed), `calendarIdOrTitle` (resolves by id, then case-insensitive title, else first writable), `addGoogleMeet`, `colorId`. Instantiation lands through `AppModel.createEvent` so the resulting event is indistinguishable on google.com from a manually-created one. Palette entry: "Insert Event Template…". Editor in Settings → Event templates.

Hard constraints for both:
- No template metadata ever lands in task notes, event description, or `extendedProperties`.
- Codable backcompat: decodeIfPresent on new event-template fields keeps pre-§6.13b caches loadable.

### 6.14 Scrollable month navigation — shipped `94e923c` + directional-slide polish

Month grid responds to trackpad / wheel scroll. NSEvent.scrollWheel local monitor on hover; 45pt accumulator threshold + 0.22s cooldown throttles a long swipe to one-month steps. Weekday header pinned outside the animated container. `monthDirection` tracks paging direction; id-keyed asymmetric slide+opacity transition: forward slides up from bottom, back slides down from top. External anchor changes (chevrons, mini-calendar, shortcuts) infer direction via onChange. Scroll threshold sits above `DragGesture(minimumDistance: 6)`, and drag-to-create is a different event family, so gestures don't collide. Month view only; Day/Week retain chevrons.

### 6.15 Vim keybind removal sweep — shipped

Re-verified `Features/Vim/` directory absent; no `VimHud` / `VimKeyboardMonitor` / `VimTranslator` / `VimAction` / `vimContextHandler` / `isVimDetailFocused` references in live files. Scrubbed stale doc comments in `HCBChord.swift` and `MacSidebarShell.swift`. Chord feature ships with `⌘K` only. `grep -r vim .` returns only historical docs + commit messages.

## §7.01 Visual reference — frontend refactor

Reference survey of Things 3, TickTick, and Apple Calendar distilled into a four-phase frontend-only refactor. No Google DTO, sync-layer, or AppModel contract changes. All changes built clean.

**Phase A — low-risk polish**
- Collapsible task-list section headers in `StoreView.allTasksList`. Chevron rotates on toggle; fold state persists via new `AppSettings.collapsedTaskListIDs: Set<TaskListMirror.ID>` (Codable `decodeIfPresent` for backcompat).
- `MarkdownBlock` view in `Design/MarkdownText.swift` — renders bullet (`- `, `* `) + numbered (`N. `) lists + paragraphs on top of inline `Text.markdown` (bold/italic/links). Wired into `TaskInspectorView` NOTES card and `TasksView.readNotesCard`. Edit mode still routes through `MarkdownEditor` (plain-text source).

**Phase B — task surface**
- `TimeBucket` enum (`today` / `upcoming` / `later` / `someday`) + `StoreFilter.timeBuckets` case. New "Time Buckets" entry in filter menu renders `timeBucketsList` with section header + count badge per bucket. Derived from existing `dueDate`; respects `showCompleted`, search, and visible-lists selection.
- `StoreTaskRow` gains leading chevron toggle + `isExpanded` @State. Expanded detail shows `MarkdownBlock` notes, list name, and an "Open Full…" button that routes to `.editTask(task.id)` via `RouterPath`. Hover-preview suppressed while expanded.

**Phase C — quick create**
- `QuickCreatePopover` gains `isExpanded` + `[+ More]` button. Expanded fields: location, notes, attendees (comma-separated emails), reminder picker (None / at start / 5/10/15/30/60 min before) for events; notes for tasks. Save path threads new fields through existing `model.createEvent` / `createTask` — no API changes.

**Phase D — calendar**
- `CalendarTaskCheckbox` — standalone clickable checkbox component. Routes through `model.setTaskCompleted(_:task:)`. Added to Month/Week/Day task tiles alongside `CalendarTaskPreviewButton` so completing a task doesn't open the preview popover. Strikethrough + 55-60% opacity on completed.
- `CalendarGridMode.multiDay` + `AppSettings.multiDayCount: Int` (clamped [2,7], default 3, Codable backcompat). `WeekGridView` gains optional `multiDayCount` parameter; `weekDays` picks N consecutive days from `anchorDate` when set. All `geo.size.width / 7` hardcoded values replaced with `/ CGFloat(weekDays.count)`. `multiDayStepperBar` in `CalendarHomeView` exposes ± controls; `shift(by:)` pages by `multiDayCount` days in this mode.
- `CalendarGridMode.year` + new `YearGridView.swift` — 4×3 `LazyVGrid` of mini-months, each a 7-column day grid with event-count heatmap shading (AppColor.ember opacity scaled to max-day count). Clicking a day sets `selectedDate` + switches mode to `.day`. Uses existing `CalendarGridLayout.monthCells` helper. Respects the calendar-selection pipeline so hidden calendars don't contribute to the heatmap.
- **Agenda view replaced** with TickTick-style flat chronological. `agendaContent` now renders a 14-day window starting at `selectedDate`, with date-header sections (Today badge highlight) containing events (time-sorted) + due tasks interleaved. Tasks use `CalendarTaskCheckbox` for inline completion. `agendaEventsByDay` walks multi-day events across the range; `agendaTasksByDay` buckets tasks by due day.
- Non-exhaustive-switch sites updated: `periodTitle` for `.multiDay` / `.year`, `shift(by:)` + `jumpLarge(by:)` paging semantics per mode.

LayoutSection auto-picks up new CalendarGridMode cases via `allCases`. No changes needed to mode-visibility settings.

## §7.02 Performance — first pass

- CalendarMirror retention window. `AppSettings.eventRetentionDaysBack` (Int, default 365, clamped to [0, 3650], 0 = keep-forever). Settings → Sync → "Keep past events" picker. `SyncScheduler.mergeEvents` drops events whose `endDate` is older than the cutoff; carve-outs preserve optimistic-pending writes and events with `updatedAt` inside the window (so reopening a past meeting to edit notes doesn't make it vanish between syncs). `AppModel.setEventRetentionDaysBack` applies the same cutoff in-memory on toggle so the cache shrinks immediately.
- MonthGridView per-pass hoist. `filteredEvents` + `eventsByDay` computed once per body evaluation and threaded into `grid`, `weekRow`, and `monthCell` as parameters — prior structure made each `monthBands` call re-scan the full events list per week, O(events × weeks). Now O(events) plus O(weeks) dict lookups.

## §7.02 Performance — second pass (Phase A + B, 2026-04-22)

- A1: `AppModel.scheduleCacheSave()` debounces cache writes to 500ms; sync-flush bursts coalesce into a single disk hit. `flushPendingCacheSave()` is bound to scenePhase background to guarantee no in-flight write is lost on suspend.
- A2: `AppModel.eventsByCalendar` index built once per `rebuildSnapshots()`, consumed by Month/Week/Day grid `visibleEvents` / `filteredEvents` so per-render filters operate on already-bucketed events instead of the full corpus (~17k+ → ~3k typical).
- A3: `AppModel.scheduleRebuildSnapshots()` coalesces upsert/remove-driven rebuilds via `DispatchQueue.main.async` — multiple rapid mutations (e.g. a sync flush of dozens of upserts) collapse to one rebuild per runloop tick.
- B2: `LocalCacheStore` splits events into `cache-events.json` sidecar; main `cache-state.json` no longer carries events. `lastEventsHash` gates sidecar writes so settings/task-only mutations never touch the multi-MB blob. Legacy monolithic-format cache files migrate transparently on first save. Encrypted setups encrypt main + sidecar independently. Tests in `LocalCacheStoreSplitTests` cover split, merge, hash skip, etag-bust, legacy migration, encrypted roundtrip, and corrupt-sidecar fallback.

## §7.02 Performance — third pass (2026-04-23)

Closes the correctness + hot-path-bloat set from the static audit.

- Audit log O(1) append: `MutationAuditLog` writes one JSONL line per record instead of re-encoding the whole buffer (~10MB atomic rewrite per checkbox click → single `FileHandle.seekToEnd` + write). v1 JSON-array files migrate to v2 JSONL on first read. See `8e5beda`.
- `AppModel.dataRevision` replaces count-based cache keys in MonthGridView / WeekGridView / CommandPaletteView — renames / reschedules / recolors that kept total count unchanged used to leave caches stale. See `3886e94`.
- O(1) lookup dictionaries (`tasksByID` / `eventsByID` / `taskListsByID` / `calendarsByID`) rebuilt in `rebuildSnapshots`; `task(id:)` / `event(id:)` now hit a hash instead of scanning. `CalendarHomeView.agendaEventsByDay` / `agendaTasksByDay` read from the prebuilt `eventsByDay` / `tasksByDueDate` indexes instead of rescanning the full corpus per body eval. See `0879b0e`.
- Command palette regex compiled once per query instead of once per entity (17k-entity scan was paying 17k regex compilations). See `1fd6913`.
- Notifications + Spotlight decoupled from the user path and debounced independently (500ms / 2s). Sync-flush storms collapse to one rescan instead of one per mutation. See `dde55e7`.
- Kanban `LazyHStack` + `LazyVStack` so off-screen columns and off-screen cards don't instantiate. See `410a90a`.
- Near-realtime poll backs off 4× (capped at policy.maxDelay) on constrained network or low-power mode. See `33a0f3d`.
- Calendar events endpoint page size 250 → 2500; `SyncScheduler` fan-out bounded to a 5-wide sliding TaskGroup window. See `e53bf4f`.
- `NotesView.orderedTasks` uses Set membership instead of O(n²) Array.contains; `StoreView.completedCount` reads `taskListCompletionStats` instead of refiltering tasks; release cache encoder drops `.prettyPrinted` + `.sortedKeys`. See `371626a`.

## §10 Cybersecurity hardening — audit pass 1

First focused pass. Reviewer swept four surfaces; two came back clean, two got fixes.

- **URL-scheme handler** (`HCBDeepLinkRouter.swift`) — clean. Scheme/host allowlist, per-param 2 KB cap, id length guard. `new/*` actions write only to staging slots (`pendingTaskPrefill` / `pendingEventPrefill`); no mutation reaches the network without an explicit user confirm in the sheet. No injection path found.
- **Natural-language parsers** (`NaturalLanguageTaskParser` / `EventParser` / palette) — clean. No eval-style dispatch (Swift has none). Parser output never concatenates into URLs. All regex patterns use `\b` anchors + bounded quantifiers — no catastrophic-backtracking risk.
- **Shared Inbox payload trust** — **fixed.** `SharedInboxItem` now carries a `source` (bundle id of the writer). `SharedInboxDefaults.consumeAll` drops items whose source doesn't match the `com.gongahkia.hotcrossbuns` prefix, whose `createdAt` is outside a 10-minute trust window (with 60 s negative-skew tolerance), or whose `text` exceeds an 8 KB byte cap. The suite is still cleared on read to avoid stale attacker payloads sitting indefinitely. Both `AppDelegate.handleServiceInvocation` (Services menu) and `ShareViewController.extractPayload` (Share Extension) stamp `Bundle.main.bundleIdentifier` as source. Extension-side `SharedInboxItem.swift` duplicate kept in sync — schema-only, no read path there.
- **Secrets in logs / crash reports** (`AppLogger.swift`) — **fixed.** Previously every log line was passed to `os_log` with `privacy: .public`, which meant GTMAppAuth/Google API error descriptions flowing through `metadata` fields (transitively carrying OAuth error details and API response body excerpts) were readable in Console.app by any process on the machine. `bridgeToOSLogger` now composes the line from individually-tagged interpolations: time/level/category/bare message as `.public`, the metadata map as `.private`. Local file ring + in-memory ring still record the full text for in-app Diagnostics; only the Console.app surface is narrowed.

Items still open from §10: Codable strictness sweep across Google API DTOs, Keychain access-group scope verification (blocked on team ID — §3a), SwiftPM dependency vulnerability scan (external tool).

## §14 Residual risks fixed since the last audit pass

- `LocalNotificationScheduler.add(_:)` silently swallowing scheduling errors — `8ddb989` surfaces failures in `NotificationScheduleSummary` and Diagnostics.
- Google Calendar's default reminder not honoured as a local notification — `c8b0393` decodes `defaultReminders`, carries a `usedDefaultReminders` flag on event mirrors, merges at `AppModel.upsert`, and makes the scheduler respect `event.reminderMinutes.first` instead of hard-coding -15 min.
- `ICSDateParser` DateFormatter shared across calls with per-call `.timeZone` mutation — `d4e1346` builds a fresh formatter per call.
- Tasks `updatedMin` watermark 60-second slack — `906a7f2` widens to 300s via a named constant.
- Tasks `updatedMin` watermark derived from local clock — follow-up now reads Google's response `Date` header from the first page of each `listTasks` response and uses that as the next watermark, eliminating clock-drift exposure. `GoogleAPITransport.getWithServerDate` parses RFC 1123 / RFC 850 / asctime formats. `listTasks` returns `GoogleTasksPage { tasks, serverDate }`; `SyncScheduler` falls back to `syncStartedAt - 300s` slack only when the header is missing or unparseable. Two new transport tests cover both paths.
- Single-occurrence recurring-event PATCH and `originalStartTime` — verified safe during live QA on a weekly recurring series. Test executed both ways: (a) title edit via "This event only" in the Edit sheet, (b) drag-to-reschedule moving one occurrence to a different time via the month/week grid. In both cases only the chosen occurrence changed on google.com; the rest of the series was untouched. Google's API correctly infers the occurrence from the instance-ID suffix form `_<yyyymmddThhmmssZ>` without needing a client-supplied `originalStartTime` field in `GoogleEventMutationDTO`. Our `GoogleCalendarClient.updateEvent` assumption holds; no DTO changes needed.

## §15 Appearance migration — done

Phase 1 added the env infrastructure; Phase 2 migrated 508 call sites across 29 files.

- `.font(.X)` / `.font(.X.weight(.Y))` → `.hcbFont(.X)` / `.hcbFont(.X, weight: .Y)`
- `.font(.system(size: N, weight: .W, design: .D))` → `.hcbFontSystem(size: N, weight: .W, design: .D)`
- `.padding(N)` / `.padding(.edge, N)` → `.hcbScaledPadding(...)`
- `.frame(width/height: N)` and min/ideal/max variants → `.hcbScaledFrame(...)`

Intentionally left alone: `.font(.body.monospaced())`, `.font(.caption.monospacedDigit())`, `.font(.system(.largeTitle, design: .serif))`, etc. These rely on system-font design variants that SwiftUI's `Font.custom` can't reproduce — preserving system font here is by design.

Also left alone: native `.alert` / `.confirmationDialog` / `NSSavePanel`. AppKit-drawn, can't be scaled by SwiftUI; they follow macOS display settings.
