# Web parity implementation record

All web-parity items from the 2026-08-17 native C++/Qt to React PWA audit have
been implemented. This file is a completion record, not an active backlog.
There are no outstanding `W-*` implementation issues for another agent to
pick up.

## Product contract retained deliberately

- Hot Cross Buns remains a static, browser-only PWA. Google access tokens stay
  in page memory only; there is no backend, refresh-token persistence, native
  wrapper, tray, closed-app sync, or closed-app reminder delivery.
- IndexedDB records are partitioned by Google OpenID subject. Google remains
  the source of truth for synchronized Task and Calendar fields; local-only
  metadata is labelled and never encoded into ordinary Google fields.
- Core flows target current Chrome, Edge, Firefox, and Safari. Installed
  Chromium PWAs progressively add app badges, protocol/file handlers, and
  install integration; normal HTTPS routes and the in-app controls remain the
  portable fallback.

## Completed feature map

| Former item | Delivered behavior |
| --- | --- |
| W-01 | Explicit foreground-only authorization, sync, and reminder model; no token storage outside memory. |
| W-02 | Browser support and install policy in `README2.md`. |
| W-03 | Disabled, notes-only, and mirrored Notes projection over undated root Google Tasks. |
| W-04 | Subject-scoped task priority and due-time-zone metadata, with task ordering and palette filtering. |
| W-05 | Native-compatible HCB v2 recurrence marker codec, recovery states, editor validation, completion/sync successor creation, duplicate avoidance, and conformance tests. |
| W-06 | Selectable task batches: complete, delete, cross-list move, reparent, set/clear due date, set priority, and recurrence-safe text replacement with per-row outcomes. |
| W-07 | One-to-one task-to-event scheduling links, unscheduled task UI, temporary-ID remapping, move reconciliation, and orphan-link repair after sync. |
| W-08 | Parser-backed Quick Capture with editable recognition chips, dates/times/durations, task/event and priority aliases, recurrence, and per-subject defaults. |
| W-09 | Persisted 30-day / 200-entry configurable undo-redo history, expiry cleanup, and version-conditional compensating writes. |
| W-10 | Accessible day/week time grid with create, move, resize, all-day lane, selection, all bulk event actions, and recurring instance / following / series handling. “This and following” performs the documented two-write series split and warns that future exceptions reset. |
| W-11 | Advanced event fields: color, transparency, visibility, popup overrides, guest permissions, response comments, and `sendUpdates`; PATCH payloads preserve omitted Meet and attachment data. |
| W-12 | Primary-calendar Focus Time, Out of Office, and Working Location creation/editing with Google field constraints. |
| W-13 | Canonical-cache invitation inbox plus online/offline RSVP comments and queued retry/conflict recovery. |
| W-14 | Structured search aliases (`source`, `status`, `start`, `priority`, `list`, `notes`/`body`), local-only filtering, and incremental scroll-loaded results. |
| W-15 | Subject-scoped appearance, density, font, accent, planner, notes, conflict, undo, quick-capture, and calendar-visibility preferences. |
| W-16 | Worker-based local delimited-text, exact-schema CSV, and iCalendar import preview/commit; drag/drop and picker everywhere, `LaunchQueue`/manifest file handlers where Chromium supports them. |
| W-17 | Explicit user-initiated redacted diagnostics copy/download with version, capabilities, cache counts, storage, and sync state only. |
| W-18 | Persisted task/event/RSVP conflict records covering direct and queued 409/410/412 failures, plus Prefer Google / Prefer Local / Ask settings and conflict history. |
| W-19 | Foreground popup-reminder derivation from event overrides or calendar defaults, notification permission, persisted Snooze 10/Dismiss state, and notification-click event routes. |
| W-20 | Safe same-origin `/task/<id>` and `/event/<calendarId>/<id>` routes, copy controls, malformed/not-cached recovery state, and optional `web+hotcrossbuns` handling. |
| W-21 | Feature-detected installed-PWA badge counts for pending mutations plus foreground reminders, with in-app equivalents. |
| W-22 | 192px/512px raster maskable icons, static-only service worker, update prompt, manifest file handlers, installation documentation, and Playwright PWA smoke coverage. |

## Important implementation boundaries

- Calendar recurrence remains Google-owned (`RRULE`/`EXDATE`/`RDATE`), with
  visible instances fetched from Google. The PWA does not create a competing
  Calendar recurrence expander.
- “This and following” splits a Google series by trimming the old master and
  inserting a new master from the selected instance. It is a two-request API
  operation; a failed second request attempts to restore the original master
  and reports a repair state if restoration fails.
- Browser notifications are foreground only. They are derived from the local
  occurrence cache, never from email reminders, and never fire after all PWA
  tabs close.
- Conflict history preserves local intent but never executes a destructive
  overwrite without a version-conditional request. A resource which no longer
  exists or cannot be read stays visible as a recoverable record.

## Verification completed

```sh
npm --prefix web run typecheck
npm --prefix web run test:run
npm --prefix web run build
npm --prefix web run test:e2e
```

The suite covers recurrence marker recovery, import formats, diagnostics
redaction, subject isolation, component behavior, and PWA manifest/service
worker registration. E2E uses the locally installed Playwright Chromium.

## Source constraints

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Calendar recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
- [Google Calendar event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Google Calendar status events](https://developers.google.com/workspace/calendar/api/guides/calendar-status)
- [PWA protocol handlers](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/protocol_handlers)
- [PWA file associations](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Associate_files_with_your_PWA)
- [PWA app badges](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon)
