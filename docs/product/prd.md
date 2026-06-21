# Product PRD

## Product Summary

Hot Cross Buns is a keyboard-first desktop planner backed by Google Tasks and Google Calendar. It helps one user capture tasks quickly, plan across tasks and calendar events, keep lightweight notes, and optionally expose controlled local MCP tools to their own agent clients.

The first release is a macOS core app. The product direction must support future Windows and Linux releases without rewriting the app architecture.

## Target Users

- The primary user is an individual desktop power user who lives in Google Tasks and Google Calendar.
- The secondary user is an agent-driven workflow user who wants local MCP tools for planning and task/calendar actions.
- The maintainer/user is also a developer who needs fast local builds, clear debugging, and agent-friendly specs.

## Goals

- Rebuild the app on a stack with a faster edit-debug loop than the Swift implementation.
- Preserve the core value of Hot Cross Buns: fast capture, calendar/task planning, keyboard navigation, local cache, Google sync, and agent access.
- Make the implementation easy for future agents to extend safely.
- Keep Google Tasks and Calendar as the synced sources of truth.
- Avoid creating a custom cloud backend in v1.

## Success Criteria

Mac core app success:

- User can connect Google through desktop OAuth.
- User can view selected task lists and calendars from local cache after sync.
- User can create, edit, complete/reopen, move, and delete tasks.
- User can create, edit, and delete calendar events.
- User can create and search task-backed notes.
- User can open command palette and quick capture without leaving the keyboard.
- Tray/menu bar and global hotkey flows work on macOS.
- Local MCP read tools work behind bearer-token authentication.
- MCP write tools support dry-run and confirmation.
- Tests cover domain logic, SQLite migrations, IPC contracts, Google transport mocks, MCP contracts, and launch smoke flows.

## V1 Scope

Core v1 includes:

- Onboarding and Google OAuth setup
- Tasks, task lists, subtasks, completion, deletion, and move flows
- Calendar agenda/day/week/month views with event create/edit/delete
- Task-backed notes and note search
- Command palette
- Global quick capture
- Local-first search over cached tasks, events, and notes
- Local cache and sync checkpoints
- Offline mutation queue
- Settings for Google, sync, appearance, hotkeys, tray, notifications, MCP, diagnostics
- Local MCP server
- Basic local notification scheduling
- GitHub Releases based preview distribution

## Non-Goals

V1 does not include:

- Hosted sync server
- Multi-user collaboration beyond Google sharing behavior
- Google Drive integration
- Mobile apps
- Full Spotlight/App Intents/Share Extension parity
- Public analytics SDK
- Cloud crash reporter by default
- App-specific task fields that cannot be represented in Google Tasks unless explicitly local-only

## Product Principles

- Correctness before polish.
- Local cache improves speed but does not become the synced source of truth.
- The keyboard path must be first-class.
- Every privileged boundary must be explicit.
- If a feature cannot work safely through renderer-only code, it belongs in main/worker services.
- Mac-first should not mean Mac-only architecture.

## Open Product Questions

These do not block docs or scaffold, but must be resolved before v1 release:

- Whether notes need a future provider beyond their current Google Tasks-backed representation.
- Whether Windows/Linux v1 should support feature parity or a smaller planner-only subset.
- Whether public distribution should remain unsigned preview or move to signed/notarized releases before broad use.
