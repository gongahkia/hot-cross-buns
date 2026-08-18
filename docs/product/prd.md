# Product PRD

## Product

Hot Cross Buns is a local desktop client and web client for a user's Google Calendar and Google Tasks account. It keeps an on-device cache and mutation journal for speed and offline work. The public web build is direct-only; an optional reliable web stack is self-hosted by its user and never operated by Hot Cross Buns. Notes are an optional HCB projection of undated Google Tasks and sync as ordinary Google Tasks.

## Target user

An individual who needs a fast, keyboard-accessible planner that is a credible desktop alternative to Apple Calendar while retaining Google Calendar and Google Tasks as the authoritative services.

## Release success

- User supplies a Google Desktop OAuth client and connects their own account through PKCE loopback authorization.
- Tasks support lists, hierarchy, create/edit/complete/delete/move/reparent/reorder, batch actions, and durable offline mutations.
- Notes can be disabled, shown only as undated task projections, or mirrored in Tasks and Notes.
- HCB recurring tasks preserve portable marker metadata and reconcile successor duplicates. The web can additionally store one exact portable task reminder time per task; the self-hosted worker considers only tasks with that explicit marker.
- Calendar supports agenda/day/week/month views, search, structured create/edit/delete/move/bulk actions, arbitrary Google recurrence round-tripping, Google-resolved instances, Meet creation, Drive metadata attachment picking, invitations/RSVP comments, free-busy, calendar creation/subscription, and Focus/OOO/working-location fields where Google exposes them.
- Calendar popup reminders create local macOS notifications with Snooze 10 minutes and Dismiss.
- Search is local-first, structured, saved, ranked, and does not query Google per keystroke.
- Presentation settings cover appearance, density, week start, 12/24-hour time, display timezone, work hours, calendar visibility, event colors, and reminders.
- The app has a macOS native bundle, automated C++/QML/shell coverage, and a redacted live Google account smoke procedure.

## Explicit exclusions

- HCB cloud storage or multi-user collaboration outside Google Calendar sharing.
- A global quick-capture shortcut.
- A separate remote notes schema.
- Reimplementing Google Calendar RFC recurrence expansion locally.
- Linux/Windows release parity before macOS acceptance.
- Full Google Calendar administrator ACL management; this is deferred as a dedicated issue.

## Product rules

- Google Calendar/Tasks behavior wins by default during sync conflict resolution; alternatives are user-selectable in Settings.
- Cross-list task moves recreate on the destination and delete the original, so the remote task ID changes.
- Calendar recurrence stores and sends valid Google recurrence lines unchanged. Google’s instances API resolves exceptions, cancellations, and concrete instances.
- Task due values follow the Google Tasks date-only API constraint. Timed work is modeled as Calendar events.
