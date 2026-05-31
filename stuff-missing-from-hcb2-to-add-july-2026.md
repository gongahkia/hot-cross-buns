# Stuff missing from hot-cross-buns-2 (to add — July 2026)

Gap analysis of features present in `../hot-cross-buns` (SwiftUI macOS original) that are **missing** or **partial** in this repo (`hot-cross-buns-2`, Electron + React + TS).

## Methodology

- Two parallel Explore passes (one per repo) produced feature inventories.
- Cross-checked claims in hot-cross-buns-2 with `rg` for keywords that would indicate the feature exists under a different name (snooze, tags, areas, templates, attachments, undo, kanban, ICS, encrypt, spotlight, app intent, share extension, chord/leader, dock badge, google meet, RSVP, multi-day, year view, natural language).
- Anything found to exist (even partially) is marked **Partial**, not **Missing**.

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

## Confidently missing

### Task management
- **Kanban view** — `Features/Store/KanbanView.swift` + `KanbanGrouping.swift` in original; zero matches for "kanban" in this repo.
- **Tags as a first-class entity** — tag repo, tag-task many-to-many, tag colour bindings. This repo has a "tags" perspective tab and accepts `tags` as a note frontmatter key, but no tag table, no tag CRUD, no `@tag` extraction.
- **Areas** — hierarchical grouping of task lists under areas, area sort/colour. One stray mock string in `mockPlanner.ts`; no schema, no UI.
- **Natural-language task/event parser** — `Buy milk due tomorrow at 3pm` → fields. This repo has `quickTaskParser.ts` but it parses tag/list/priority tokens only — no date/time NLP.
- **Task starring / flagging**
- **Bulk task operations** — multi-select, batched complete/reschedule/move/tag with coalescing.
- **Task / event duplication action**
- **Duplicate-task detection + duplicate-review window**

### Calendar
- **Year view** — 4×3 mini-month grid with heatmap
- **Multi-day view** — configurable 2–7 days
- **Day view** — single-day grid (only agenda/timeline/month exist)
- **Drag-to-create** on calendar grids
- **Event attendee management UI** — RSVP, response-status display, invitations
- **Google Meet / Hangouts attach** on event create
- **Event reminders editor** — custom popup minutes-before
- **Event visibility / transparency** — busy/free, public/private controls
- **Recurring-event scope picker** — this / this-and-future / all when editing
- **Day-agenda popover** from month/week click
- **RRULE editor UI** — RRULE is parsed and stored, but no UI for editing the recurrence pattern beyond raw form

### Search & quick actions
- **Regex / field-operator advanced search** — `attendee:`, `duration>30m`, `has:notes`, `due<+7d`, etc.
- **Custom-filter DSL** — `list:`, `tag:`, `AND/OR/NOT`, relative dates + saved queries
- **Pinned filters** in sidebar and on menu-bar popover with count badges
- **Spotlight indexing** of tasks and events (`CoreSpotlight` integration)
- **Quick switcher / quick-add split mental model** — `⌘O` go vs `⇧⌘P` do. Current command palette is a single surface.

### Keyboard & shortcuts
- **Leader-key (`⌘K`) chord bindings**
- **Which-key HUD overlay**
- **Per-action keybinding customisation UI** — settings tab exists; engine for chord storage does not.

### Settings, distribution, platform integrations
- **Local cache encryption** — AES-256-GCM, PBKDF2/Argon2 passphrase, session unlock sheet
- **Per-surface font customisation** — six surfaces × family/size/weight. This repo has font-family setting but not the six-surface matrix.
- **Custom colour-scheme editor** — only theme presets exist
- **Dock badge** with overdue count
- **Sync-mode selector** — manual / balanced / near-real-time. Sync runs on a single scheduler.
- **Past-event retention cutoff** — days, 0 = keep-forever
- **Past-task / overdue cleanup behaviour configuration**
- **In-app update checker** — GitHub Releases polling, version compare, download prompt. Build metadata exists; update polling does not.
- **Share extension** — macOS Share menu → quick task
- **App Intents** — macOS Shortcuts: open task editor, open event editor, open Today
- **Print export** — Today print view

### Data import/export & attachments
- **Portable `.hcbexport` package** — manifest + state + bundled attachments, SHA-256 verify, dry-run import diff
- **ICS calendar import**
- **Local file attachments** — embed image/file refs in notes/events, relink/repair after export
- **Local-pointer-repair UI** for broken attachment paths

### Today/Home surface
- **Dedicated "Today" view** — overdue + due-today + upcoming events with sidebar-filter respect. Current screens are Tasks / Calendar / Notes / Settings.

### Performance & ops
- **Low-power-mode and constrained-network detection** → sync backoff multipliers
- **Prepared snapshots / pre-bucketed event indexes** for large accounts (15k-event regression suite in original)
- **Notification permission primer screen** — separate from generic onboarding

### Localisation
- **String catalogue / i18n scaffold** — `.xcstrings` equivalent for the React app

## Partial (schema/plumbing exists, UI thin or missing)

- **Snooze** — `local_snooze_until` DB column + `snoozeUntil` viewmodel field exist; no inspector control / no snooze surface in UI.
- **Task templates / Event templates** — settings tab + viewmodel defaults exist (`taskTemplates: []`, `eventTemplates: []`), but expander logic and template-instantiation UX (variable expansion `{{today}}`, `{{+Nd}}`, `{{prompt:Label}}`, `{{clipboard}}`) appear minimal vs. the original.
- **Local notification scheduling** exists (`notificationScheduling.ts`) but customisable lead-times (9 AM-of-due-date for tasks, 15 min before timed events) and 64-notification cap behaviour are not surfaced.
- **History** — repository in main exists, no renderer history-window UI for surfacing mutation log beyond MCP audit.
- **Subtask hierarchy** — Google Tasks parent/child preserved by sync, but inspector UX for hierarchical edits is thin.

## Genuinely unclear from static read (need runtime check)

1. **MCP tool catalogue parity vs. original** — both repos expose an MCP server, but the exact tool names (`hcb_today`, `hcb_week`, `hcb_search`, `hcb_create_task`, …) and per-tool dry-run/confirm-write/allow-write permission modes haven't been enumerated. Needs `src/main/mcp/toolRegistry.ts` audit.
2. **Snooze UX depth** — DB + viewmodel say snooze exists; inspector doesn't obviously surface it. May be a settings-driven hide vs. truly absent.
3. **Template engine** — settings tab lists templates and viewmodel has empty arrays for both; whether any expansion/substitution actually runs has not been verified.
4. **Recurrence editing depth** — RRULE round-trips through sync, but UI for editing recurrence patterns (vs. read-only display) wasn't located. Check `CalendarEventForm.tsx`.
5. **Subtask UX** — sync preserves parent/child; how deeply the inspector exposes hierarchical editing isn't clear from a static read.

## Critical files for any follow-up audit

- `src/main/mcp/toolRegistry.ts` — confirm MCP tool parity
- `src/renderer/src/features/core/inspectors/TaskInspectorBody.tsx` — confirm snooze/subtask/template UX
- `src/renderer/src/features/core/screens/settings/AdvancedSettingsTab.tsx` — confirm template engine
- `src/renderer/src/features/core/screens/calendar/CalendarEventForm.tsx` — confirm attendees / Meet / reminders / visibility editors
- `src/main/sync/readSyncRepository/recurrence.ts` and the calendar form — confirm recurrence-edit scope
- `src/main/native/notificationScheduling.ts` — confirm notification lead-time configurability

## Verification plan

1. `pnpm install && pnpm dev` in this repo — exercise Tasks / Calendar / Notes / Settings and try to invoke each "Missing" feature. Confirm absence.
2. In `../hot-cross-buns`, `make run-apple` (or open Xcode project) — exercise the same flow to confirm the feature exists in the original.
3. For "Partial" items, open the listed files and confirm whether the UI surface is wired up.

## Suggested next-step slices (priority order)

1. Audit the five "unclear" items above and re-classify each as Present / Partial / Missing.
2. **Tags + Areas + Kanban** — share schema work, biggest task-management UX gap.
3. **Spotlight + App Intents + Share Extension** — high-value macOS integrations, all isolated.
4. **Advanced search + Custom-filter DSL + Saved/pinned filters** — biggest UX win, no external API surface needed.
