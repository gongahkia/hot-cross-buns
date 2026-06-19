# Core App Spec

## Scope

The core app is the first user-facing implementation target. It covers tasks, calendar, notes, search, command palette, tray/menu-bar entry, global hotkey capture, settings, diagnostics, and basic notifications.

macOS is the first supported platform. UI and service contracts must be written so Windows and Linux can be added through platform adapters.

## App Shell

The first screen after setup should be the usable planner, not a landing page. The shell should include:

- sidebar navigation
- main content region
- command palette
- global status banner
- sync state indicator
- settings entry
- keyboard-accessible navigation

Primary sections:

- Today
- Tasks
- Calendar
- Notes
- Search
- Settings

## Tasks

Required task capabilities:

- list task lists
- create task
- edit title, notes/details, due date, priority, parent, and list
- complete and reopen task
- delete task
- move task between lists
- bulk-select visible tasks
- bulk complete/reopen, move, and delete selected tasks
- display subtasks
- filter completed/deleted/hidden tasks
- support local optimistic updates through the mutation queue

Google Tasks constraints:

- Due dates are date-based in the public API. Time-specific planning belongs in Calendar events.
- App-only fields must be local-only unless explicitly representable in Google.

## Calendar

Required calendar capabilities:

- list selected calendars
- agenda view
- day view
- week view
- month view
- create timed and all-day events
- edit event title, location, notes, guests, reminders, start/end, calendar
- delete event
- display recurring event instances from Google data
- export static text availability for selected calendars and a date range

Calendar views must be virtualized or windowed where large accounts could create expensive renders.

## Notes

Notes are represented as undated, root Google Tasks rows and cached locally through the task mirror.

Required note capabilities:

- create note
- edit note title/content
- delete note
- preview markdown-style note content
- resolve `[[note title]]` links and backlinks
- search note title/body
- link note rows to tasks/events later through explicit metadata

Notes must not use separate local SQLite note tables.

## Search

Search is local-first and must not call Google per keystroke.

Search sources:

- task title and notes/details
- event title, location, description
- note title and body
- list/calendar names

Search results should include deep links into the app and should identify source type.

Implemented local query syntax:

- Plain text terms search cached task title/notes/list names, event title/location/description/calendar names, and note title/body.
- `source:` or `domain:` narrows to `tasks`, `calendar`, and/or `notes`; aliases include `task`, `event`, and `note`.
- `status:` filters tasks by `active`/`open`, `completed`/`done`, `hidden`, or `deleted`.
- `due:` filters task due dates; `start:` filters event start dates. Supported windows are `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `YYYY-MM-DD..YYYY-MM-DD`, `any`, and `none`.
- `priority:` filters tasks by `none`, `low`, `medium`, or `high`.
- `list:` filters task list title, and `calendar:`/`cal:` filters calendar title. Quote multi-word values, for example `list:"Product Planning"`.
- `notes:` or `body:` filters body/details presence with `yes` or `no`.

The renderer shows parsed filters as chips and reports invalid structured syntax inline without executing a search request. Saved custom filters are not implemented yet; they should wait until saved-view storage is added through settings or the local database.

## Command Palette

The command palette is a first-class workflow surface.

Required commands:

- new task
- new event
- new note
- quick capture
- go to Today
- go to Tasks
- go to Calendar
- go to Notes
- open Settings
- refresh
- force full resync
- toggle MCP server if enabled by settings
- copy diagnostics summary
- search filter syntax

Palette commands should call the same service APIs as visible UI controls.

Current implementation notes:

- Renderer command metadata now comes from a shared action registry with stable IDs such as `task.create`, `calendar.create`, `calendar.view.week`, `note.create`, `sync.refresh`, and `diagnostics.copy`.
- Command palette entries show disabled reasons when required cached resources or selected-item context are unavailable.
- Visible task, calendar, note, settings, diagnostics, and refresh controls expose matching action IDs for tests and future context-menu/telemetry reuse.
- Selected-item palette execution is not fully global yet; selected task actions are wired in the Tasks toolbar and remain disabled in the palette until the shell owns shared selection context.

## Tray And Hotkeys

macOS v1 must include:

- tray/menu-bar icon
- show/hide main window
- quick capture
- refresh
- open settings
- quit
- configurable global quick capture shortcut

If a shortcut registration fails, the app must show an actionable settings error and keep running.

## Settings

Required settings areas:

- Google account and OAuth setup
- selected task lists and calendars
- sync mode
- appearance
- hotkeys
- tray/menu-bar behavior
- local notifications
- local data controls
- MCP agent access
- diagnostics and recovery

Settings must not expose raw tokens, secrets, cache encryption keys, or full Google diagnostic payloads.

## First-Run Setup

Current Mac v1 setup behavior:

- The app shows a first-run setup modal when local settings have no `setupCompletedAt` timestamp.
- Setup writes normal local settings through the existing typed preload IPC: backend choice, selected task lists, selected calendars, sync mode, notification preference, optional MCP enablement/permission mode, and the setup completion timestamp.
- Google setup is represented as runtime/OAuth readiness and current sanitized account state only. The flow does not collect OAuth client secrets and does not create new Google transports.
- Users can choose Google, HCB local vault, or HCB local hoster setup. Local backend choices can finish without Google, seed a local inbox/calendar when needed, and stop Google pending-mutation queueing.
- Settings includes a reset onboarding action that clears only the setup completion timestamp. It does not delete planner rows, Google cache rows, checkpoints, or pending mutations.

Remaining Mac v1 blockers:

- User-facing desktop OAuth client setup and Keychain-backed token storage are still not wired into production.
- Authenticated Google transport construction, account selection, real sync scheduling, and selected-resource population from live Google data remain separate Google sync work.
- Live MCP listener startup and OS credential storage for the MCP bearer token remain separate native/runtime work.

## Acceptance Checks

- Renderer cannot access Node APIs directly.
- Every core action uses typed preload IPC.
- Task/event write flows share the same mutation services used by MCP.
- Search returns local cache results without network access.
- The app can render after restart from local SQLite before fresh sync completes.

## Current Implementation Notes

- Core IPC read routes return bounded, paginated SQLite-backed DTOs. Renderer screens load those DTOs through `coreViewModelSource` and keep route-level state small.
- UI task, task-list, calendar-event, and note commands call typed preload APIs. Task, note, task-list, and event writes optimistically update local mirrors and enqueue Google mutations only while Google is the active backend.
- MCP task, event, and note tools call the same main-side domain services as UI IPC handlers, including the same validation and backend-aware mutation queue paths.
- Local search is SQLite-backed and capped. It indexes current task title/details/list names, event title/location/description/calendar names, and note title/body; it applies the structured local DSL in main-process SQLite and never calls Google per keystroke.
- Today's local timeline is grouped into all-day, morning, afternoon, evening, and unscheduled sections using cached events, scheduled task blocks, and existing task rows. Timed tasks are represented as linked Google Calendar blocks plus local metadata; task due dates remain date-only. Today also shows next-up context, linked-block conflict warnings, and earlier/later movement controls.
- Scheduled task blocks prevent duplicate active blocks for the same task, can surface orphaned links when the backing calendar event disappears, and can repair an orphan by recreating its linked calendar event.
- Today block controls support duration changes in addition to earlier/later movement.
- Tasks support per-row multi-select plus bulk complete/reopen, move, and delete actions over the active filtered task set.
- Calendar exposes static text availability export in the renderer by calling the same typed local calendar service used by MCP and tests. Day view is an hourly planning grid where empty slots create timed event drafts directly; day/week grids accept dragged events for time/day moves, and day events expose resize handles for end-time changes.
- Notes support markdown-style preview, `[[note title]]` outgoing links, and backlinks over loaded note bodies.
- Calendar agenda, task, note, and search surfaces remain virtualized or range/pagination-shaped to preserve renderer and IPC budgets.
