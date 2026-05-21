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

Calendar views must be virtualized or windowed where large accounts could create expensive renders.

## Notes

Notes are local-only in v1.

Required note capabilities:

- create note
- edit note title/content
- delete note
- search note title/body
- link note rows to tasks/events later through local metadata

Notes must not be uploaded to Google unless a later spec adds a sync provider.

## Search

Search is local-first and must not call Google per keystroke.

Search sources:

- task title and notes/details
- event title, location, description
- note title and body
- list/calendar names

Search results should include deep links into the app and should identify source type.

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

Palette commands should call the same service APIs as visible UI controls.

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

## Acceptance Checks

- Renderer cannot access Node APIs directly.
- Every core action uses typed preload IPC.
- Task/event write flows share the same mutation services used by MCP.
- Search returns local cache results without network access.
- The app can render after restart from local SQLite before fresh sync completes.

