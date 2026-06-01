# Stuff missing from hot-cross-buns-2 (to add — July 2026)

Gap analysis of features present in `../hot-cross-buns` (SwiftUI macOS original) that are **missing** or **partial** in this repo (`hot-cross-buns-2`, Electron + React + TS).

## Already present in hot-cross-buns-2 (no work needed)

- Google OAuth (loopback flow), keychain credential storage
- Google Tasks + Calendar bidirectional sync, mutation queue, backoff, offline replay
- Calendar agenda / timeline / month views, event create/edit incl. RRULE recurrence
- Scheduled task blocks (schedule task into a calendar slot, with suggestion engine)
- Notes (local-only) with markdown rendering, link suggestions, broken-link detection
- Command palette, quick task capture, emoji picker, virtualised lists
- Settings with profiles / appearance / hotkeys / alerts / advanced tabs
- MCP server with rate limiting, audit log, metrics, bearer-token keychain, dry-run
- Diagnostics overlay (logs, perf, health, IPC metrics, export bundle)
- macOS tray / menu-bar panel, global shortcuts, native notifications, deep links (`hcb://`)
- Local SQLite cache w/ versioned migrations, secret store, Zod-validated IPC contracts
- Playwright smoke + 40+ unit tests
- **Kanban view** — `Features/Store/KanbanView.swift` + `KanbanGrouping.swift` in original; zero matches for "kanban" in this repo.
- **Natural-language task/event parser** — `Buy milk due tomorrow at 3pm` → fields. This repo has `quickTaskParser.ts` but it parses tag/list/priority tokens only — no date/time NLP.
- **Task starring / flagging**
- **Multi-day view** — configurable 2–7 days
- **Day view** — single-day grid 
- **Drag-to-create** on calendar grids
- **Day-agenda popover** from month/week click
- **Spotlight indexing** of tasks and events (`CoreSpotlight` integration)
- **Leader-key (`⌘K`) chord bindings**
- **Quick switcher / quick-add split mental model** — `⌘O` go vs `⇧⌘P` do. Current command palette is a single surface.
- **Pinned filters** in sidebar and on menu-bar popover with count badges
- **Which-key HUD overlay**
- **Per-action keybinding customisation UI** — settings tab exists; engine for chord storage does not.
- **Custom colour-scheme editor** — only theme presets exist
- **Dock badge** with overdue count

## Missing (validate if missing, implement if so)

### Task management
- **Tags as a first-class entity** — tag repo, tag-task many-to-many, tag colour bindings. This repo has a "tags" perspective tab and accepts `tags` as a note frontmatter key, but no tag table, no tag CRUD, no `@tag` extraction.
- **Areas** — hierarchical grouping of task lists under areas, area sort/colour. One stray mock string in `mockPlanner.ts`; no schema, no UI.
- **Bulk task operations** — multi-select, batched complete/reschedule/move/tag with coalescing.
- **Task / event / note duplication action** that appends copy or some sort of diferentiator
- **Duplicate-event/task/note detection + duplicate-review window**

### Calendar
- **Year view** — 4×3 mini-month grid with heatmap
- **Event attendee management UI** — RSVP, response-status display, invitations
- **Google Meet / Hangouts attach** on event create
- **Event reminders editor** — custom popup minutes-before
- **Event visibility / transparency** — busy/free, public/private controls
- **Recurring-event scope picker** — this / this-and-future / all when editing
- **RRULE editor UI** — RRULE is parsed and stored, but no UI for editing the recurrence pattern beyond raw form

### Search & quick actions
- **Regex / field-operator advanced search** — `attendee:`, `duration>30m`, `has:notes`, `due<+7d`, etc.
- **Custom-filter DSL** — `list:`, `tag:`, `AND/OR/NOT`, relative dates + saved queries

### Settings, distribution, platform integrations
- **Local cache encryption** — AES-256-GCM, PBKDF2/Argon2 passphrase, session unlock sheet
- **Per-surface font customisation** — six surfaces × family/size/weight. This repo has font-family setting but not the six-surface matrix.
- **Sync-mode selector** — manual / balanced / near-real-time. Sync runs on a single scheduler.
- **Past-event retention cutoff** — days, 0 = keep-forever
- **Past-task / overdue cleanup behaviour configuration**
- **In-app update checker** — GitHub Releases polling, version compare, download prompt. Build metadata exists; update polling does not.
- **Share extension** — macOS Share menu → quick task
- **App Intents** — macOS Shortcuts: open task editor, open event editor, open Today
- **Print export** — Print view for all views

### Data import/export & attachments
- **Portable `.hcb2export` package** — manifest + state + bundled attachments, SHA-256 verify, dry-run import diff
- **ICS calendar import**
- **Local file attachments** — embed image/file refs in notes/events, relink/repair after export
- **Local-pointer-repair UI** for broken attachment paths

### Performance & ops
- **Low-power-mode and constrained-network detection** → sync backoff multipliers
- **Prepared snapshots / pre-bucketed event indexes** for large accounts (15k-event regression suite in original)
- **Notification permission primer screen** — separate from generic onboarding

### Localisation
- **String catalogue / i18n scaffold** — `.xcstrings` equivalent for the React app

## Others
- **Snooze** — `local_snooze_until` DB column + `snoozeUntil` viewmodel field exist; no inspector control / no snooze surface in UI.
- **Task templates / Event templates** — settings tab + viewmodel defaults exist (`taskTemplates: []`, `eventTemplates: []`), but expander logic and template-instantiation UX (variable expansion `{{today}}`, `{{+Nd}}`, `{{prompt:Label}}`, `{{clipboard}}`) appear minimal vs. the original.
- **Local notification scheduling** exists (`notificationScheduling.ts`) but customisable lead-times (9 AM-of-due-date for tasks, 15 min before timed events) and 64-notification cap behaviour are not surfaced.
- **History** — repository in main exists, no renderer history-window UI for surfacing mutation log beyond MCP audit.
- **Subtask hierarchy** — Google Tasks parent/child preserved by sync, but inspector UX for hierarchical edits is thin.
- **MCP tool catalogue parity vs. original** — both repos expose an MCP server, but the exact tool names (`hcb_today`, `hcb_week`, `hcb_search`, `hcb_create_task`, …) and per-tool dry-run/confirm-write/allow-write permission modes haven't been enumerated. Needs `src/main/mcp/toolRegistry.ts` audit.
- **Snooze UX depth** — DB + viewmodel say snooze exists; inspector doesn't obviously surface it. May be a settings-driven hide vs. truly absent.
- **Template engine** — settings tab lists templates and viewmodel has empty arrays for both; whether any expansion/substitution actually runs has not been verified.
- **Recurrence editing depth** — RRULE round-trips through sync, but UI for editing recurrence patterns (vs. read-only display) wasn't located. Check `CalendarEventForm.tsx`.
- **Subtask UX** — sync preserves parent/child; how deeply the inspector exposes hierarchical editing isn't clear from a static read.
