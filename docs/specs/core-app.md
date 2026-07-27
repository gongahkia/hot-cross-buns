# Core App Spec

## Scope

The macOS Qt app has Tasks, Calendar, Notes, Search, Invitations, Settings, Diagnostics, command palette, and tray/menu-bar controls. There is no global quick-capture capability.

```text
QML views -> AppController -> C++ services -> SQLite / Google clients / macOS adapters
```

QML is unprivileged presentation. It consumes `QAbstractItemModel` data and invokes `AppController`; it does not access credentials, SQLite, or HTTP.

## Tasks and notes

- Google Tasks lists, hierarchy, completion, move, delete, reorder, and batch actions.
- Structured task create/edit includes date, due timezone metadata, priority, and HCB-managed recurrence fields with advanced marker input.
- Notes are undated root Google Tasks. Settings disables projection, shows notes only, or mirrors undated tasks into Tasks and Notes.
- Cross-list move creates a destination task then deletes the source; code must communicate the new remote ID.

## Calendar

- Agenda, day, week, and month use cached range reads and bounded visible delegates.
- Event editing has structured date/time, event timezone, all-day date semantics, color, availability, visibility, reminders, guests, guest permissions, send-updates, Meet, Drive metadata attachments, recurrence presets, and advanced raw Google recurrence lines.
- Timed editors display and create wall time in the selected event timezone. All-day dates remain date-stable.
- Calendar recurrence lines are preserved. Google-resolved instance data is authoritative for rendering and exceptions.
- Invitation Inbox lists the current user’s `needsAction` invitations and sends RSVP status plus optional comment.
- Calendar creation, subscription, sharing actions, free-busy, and status-event fields use Google APIs where the active account grants access.

## Search and command palette

Search is local-only per keystroke. It searches task, event, note, list, and calendar cache fields and accepts the documented structured DSL: `source:`, `status:`, `due:`, `start:`, `priority:`, `list:`, `calendar:`, and `notes:`/`body:`. Results have deep links, parsed chips, validation errors, saved searches, and truthful pagination.

The command palette exposes in-app create, navigation, search, sync, settings, and diagnostics commands. It calls the same controller/service path as visible controls.

## Reminders

The app derives local notifications from synced Google Calendar popup reminders, including calendar defaults and event overrides. Email reminders are never represented as native notifications. macOS notification actions are Snooze 10 minutes and Dismiss; reminder state is stored locally and idempotently.

## Acceptance

- App starts and renders cached data without network access.
- Every visible write validates, updates local state transactionally, and queues a mutation when needed.
- Google request work is bounded, cancellable, and cannot outlive shutdown unsafely.
- Calendar and task recurrence preserve the contracts above.
- macOS C++/QML/shell tests and release-scale benchmarks pass before live-account validation.
