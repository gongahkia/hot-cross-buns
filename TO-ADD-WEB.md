# Web parity audit and implementation backlog

## Purpose and scope

This is a repository-grounded comparison of the native C++/Qt desktop product in
`native/` and the separate React PWA in `web/`, assessed on 2026-08-17. It is a
backlog for bringing **native capabilities to the web PWA**. The request said
"port ... over to the desktop version," but that conflicts with the preceding
request to identify what the web lacks; this document therefore assumes the
intended direction is desktop -> web.

The two products intentionally have different trust boundaries. A "gap" below
means either absent web behavior or a material loss of capability; it does not
necessarily mean a native mechanism itself should be copied. This document
locks the web implementation decisions so it can be used directly by an
independent implementation agent.

Evidence used:

- Native contract and architecture: `docs/product/prd.md`,
  `docs/specs/core-app.md`, `docs/specs/google-sync.md`,
  `docs/specs/native-parity.md`, and `docs/architecture/system-architecture.md`.
- Native implementation: `native/src/`, `native/qml/`, `native/CMakeLists.txt`,
  and `native/tests/`.
- Web implementation: `web/src/`, `web/vite.config.ts`, `web/tests/`, and
  `README2.md`.
- Browser and Google API constraints: the references at the end of this file.

## Executive conclusion

The native app is the more complete planner and the more mature engineering
system. It has all core Google Tasks/Calendar flows represented by the PWA, then
adds task recurrence and priority, dedicated notes, richer event controls,
bulk operations, import/recovery/diagnostics, durable OAuth credentials,
native reminders, and macOS/Fedora integration.

The PWA is not a failed port: it is a deliberately browser-only product with a
sound privacy model. It directly calls Google with a user-owned Web OAuth
client, keeps access tokens only in memory, partitions IndexedDB data by Google
subject, keeps a canonical Calendar mirror for local search, resumes paginated
Calendar sync, and makes the page shell available offline. Its hard boundary is
that Google operations occur only while a user-authorized tab is open.

## Comparative audit

### Product capability map

| Area | Native C++/Qt desktop | React PWA | Assessment |
| --- | --- | --- | --- |
| Google Tasks baseline | Lists and hierarchy; create, edit, complete, delete, cross-list move, reparent, reorder, and offline mutations | The same baseline flows, including keyboard-accessible drag/reorder and IndexedDB outbox entries | Comparable core functionality |
| Task enrichment | Local priority, due-zone metadata, HCB-managed recurrence marker/recovery, batch mutation, scheduled task-to-event blocks, undo/recovery, and natural-language quick capture | Title, notes, date-only due date, parent/list selection, and drag/reorder | Large functional gap |
| Notes | Optional view of undated root Google Tasks, with disable / notes-only / mirrored modes | The task panel is labelled "Tasks and notes," but has no dedicated notes view or projection preference | Partial only |
| Calendar baseline | Agenda, day, week, and month; local cached reads; event CRUD; all-day and time-zone handling; Google recurrence and resolved instances | Agenda, day, week, and month; range occurrence cache; event CRUD; all-day/time-zone handling; recurrence presets and raw RRULE/EXDATE/RDATE input | Comparable core functionality |
| Calendar enrichment | Event drag-create/move/resize; selection and bulk operations; event color, availability, visibility, reminders, guest permissions, RSVP comment, send-updates, invitation inbox, status events | Free/busy, calendar create/subscribe/remove, RSVP status from an event editor, Meet, Drive attachment metadata; type definitions include some unused event fields | Large functional gap |
| Search and commands | Local structured search across tasks, events, notes, lists, and calendars; saved searches; documented DSL and truthful pagination; command registry | `⌘/Ctrl+K` palette, title-first local search, calendar-history worker index, cached Drive result search, and a smaller DSL; no saved search or pagination | Different but incomplete parity |
| Settings and presentation | Appearance, density, palette mode, accent, font, week start, time format, display zone, work hours, calendar visibility, quick-capture defaults, notes, conflict policy, undo retention | OAuth/sync/privacy controls only | Large functional gap |
| Import and recovery | Validated import preview/commit, queued mutations, conflict policies, undo/recovery, redacted diagnostics | Clear browser data and reconnect; single event edit conflict dialog | Large functional gap |
| Reminders | Popup-reminder derivation, persistent snooze/dismiss state, macOS notification actions; Fedora daemon can deliver after the GUI exits | No reminder editor and no web notification implementation | Architectural and product gap |
| Desktop integration | Keychain/KDE Wallet credentials, tray/menu bar, `hotcrossbuns://` deep links, macOS bundle/Fedora RPM, platform notifications | Installable app shell only; no OS integration beyond browser/PWA support | Intentional delivery-model gap |

### Engineering map

| Dimension | Native C++/Qt desktop | React PWA | Consequence |
| --- | --- | --- | --- |
| Boundary | QML presentation -> `AppController` -> C++ services -> SQLite, Google clients, and platform adapters | React components -> `useWorkspace` hook -> direct browser `fetch`, IndexedDB, and Google Identity Services | Native has stronger process-level separation; web is smaller and easier to deploy but browser-bound |
| Persistence | SQLite cache, checkpoints, mutation journal, FTS/search data, reminder state, migrations, transaction/statement/cache abstractions | IndexedDB stores subject-partitioned snapshots, canonical events, occurrence cache, Drive metadata, mutations, checkpoints, and resumable Calendar sync state | Both support offline cache/outbox; SQLite gives native stronger query, migration, and recovery primitives |
| Credentials | Desktop PKCE loopback; access and refresh tokens outside SQLite in Keychain/KDE Wallet | Google Identity Services token model; short-lived access token in page memory only | The web behavior is security-conscious and intentional, but prevents unattended Google work |
| Sync | Manual/Balanced/Near-real-time modes, refresh-token renewal, retry/backoff, durable generic mutation handling, selectable conflict policy | Explicit tab-session sync, task watermarks, Calendar tokens, page-level resume, cancellation, quota recovery, event-only ETag conflict dialog | The PWA has a thoughtful sync implementation, but not parity in background operation or conflict handling |
| Concurrency and performance | Qt GUI-thread result application, queued SQLite work, cancellable native HTTP, bounded QML delegates, release benchmarks | `AbortController` sync cancellation, a Web Worker for historical Calendar search, React rendering, and browser storage estimates | Native has formal performance gates; PWA needs equivalent measured budgets before complex parity work |
| Validation | CMake presets, warnings/sanitizers/static analysis hooks, packaging smoke tests, 123 declared CTest tests, QML tests, shell smoke, and release benchmarks | TypeScript build/typecheck, Vitest component/unit coverage, Playwright config with one E2E spec; 36 declared `it(...)` cases | The native verification surface is much broader; counts describe repository declarations, not a test-quality score |
| Distribution | macOS bundle/universal packaging and signed Fedora RPM paths | Static Vite build deployable to Pages; Vite PWA caches only shell/static assets | Web is operationally much simpler, but cannot reproduce all native lifecycle behavior without changing its architecture |

### Important non-gaps

Do not spend parity work reimplementing features the PWA already has:

- Task lists, tasks, hierarchy, completion, deletion, cross-list movement, and
  reorder (`web/src/components/TaskPanel.tsx`, `web/src/features/useWorkspace.ts`).
- Calendar day/week/month/agenda views, all-day events, timezone selection,
  event recurrence editing, recurrence instance/series choice, Drive metadata
  attachments, Google Meet requests, calendar creation/subscription, and
  free-busy (`web/src/components/CalendarPanel.tsx`,
  `web/src/components/CalendarTools.tsx`, `web/src/api/googleApiClient.ts`).
- Browser-local Calendar incremental sync, canonical-event search, resume
  records, cancellation, and quota recovery (`web/src/features/useWorkspace.ts`,
  `web/src/data/localStore.ts`).
- Accessible modal focus trapping and keyboard command-palette navigation
  (`web/src/components/ModalDialog.tsx`, `web/src/components/CommandPalette.tsx`).
- No global quick capture: native deliberately excludes a system-wide shortcut,
  so it is not a web gap.
- Google Calendar ACL administration: native also defers it, so it is not a web
  parity item.

## Web parity backlog

### Resolved implementation contract

- **Product boundary:** keep a static, browser-only PWA. Access tokens remain
  page-memory-only; there is no HCB backend, refresh-token persistence, native
  wrapper, system tray, or unattended Google work after the PWA closes.
- **Browser support:** core Tasks and Calendar flows support modern browsers.
  Installed Chromium PWAs may receive feature-detected protocol/file handlers
  and app badges, but every enhancement has an in-app browser fallback.
- **Data ownership:** all browser-local records, including preferences, task
  metadata, scheduling links, undo history, conflicts, and diagnostics, are
  partitioned by Google OpenID subject.
- **Prioritisation:** every backlog item is product-priority equivalent. The
  dependency relationships stated below are technical prerequisites only.

### Static-PWA constraints

#### W-01: Unattended sync, persistent Google authorization, and reminders after the tab closes

**Web gap.** The PWA’s access token exists only in `TokenSession` memory and
Google work occurs only while the page has a valid, user-authorized session.
It cannot refresh an expired token or reliably run reminders after every tab is
closed. The native app keeps refresh tokens in the OS credential store and uses
platform reminder delivery; Fedora additionally has a user service.

**Decision.** Preserve the existing static PWA trust boundary. Use the Google
token model, a visible reconnect control, and foreground-only sync/reminder
work. Do not add a backend/BFF, refresh tokens, a native companion/wrapper, or
Periodic Background Sync. A closed PWA performs no Google work and sends no
reminders.

**Acceptance.** Access and refresh tokens never enter IndexedDB, localStorage,
a service-worker cache, a URL, or logs; reconnect after expiry is explicit and
user initiated.

#### W-02: Explicit browser-support policy

**Web gap.** Several desktop-parity paths—push, notifications, file/protocol
handlers, app badges, and background sync—have browser- and OS-specific
support. The current PWA supports any capable static web host but does not say
which advanced-capability browsers are supported.

**Decision.** Add a short support matrix to `README2.md`. Treat modern browsers
as the baseline; progressively enhance installed Chromium PWAs with
feature-detected file handlers, protocol handlers, and app badges. The PWA
must show an in-app fallback wherever an enhancement is unavailable.

### Planner capabilities

#### W-03: Dedicated Notes projection and settings

**Web gap.** Native treats an undated root Google Task as an optional Notes
projection and offers disabled, notes-only, and mirrored modes. The PWA has no
`Notes` view, no projection preference, and no separation between undated root
tasks and normal Tasks.

**Implementation.** Add a `notesProjectionMode` setting to IndexedDB;
derive notes from tasks with no `due` and no `parent`; add a Notes navigation
surface that reuses the task editor/mutation pipeline. Keep the Google payload
unchanged—there is no separate remote Notes type.

**Decision.** Mirror the native three states: disabled, Notes only, and mirrored
Tasks + Notes. Search and keyboard navigation operate on the same underlying
task, never a copied note.

**Acceptance.** Edits, completion, deletion, offline updates, search, and
cross-list moves remain one Google Task mutation; a note with a due date or
parent ceases to qualify for the projection.

#### W-04: Task priority and due-time-zone metadata

**Web gap.** Native supports local task priorities and records due-zone
metadata. The web task model/editor only uses Google’s date-only `due` field.

**Implementation.** Add a subject-scoped `taskMetadata` IndexedDB store
keyed by `(subject, taskId)` for `priority` and `dueTimeZone`. Display and
filter the metadata locally; never pretend it is a Google Tasks field. Delete
or remap the metadata when a task is deleted or cross-list moved and obtains a
new Google ID.

**Decision.** Keep priority and due-timezone metadata only in subject-scoped
IndexedDB. Do not write it into Google Task notes; only W-05 recurrence uses a
portable task-note marker.

**Acceptance.** A migration/backfill is idempotent; Google Tasks remains
date-only; metadata cannot leak between Google subjects; palette filters and
task ordering have clear rules for unset priority.

#### W-05: HCB-managed recurring Google Tasks

**Web gap.** Google Tasks has no recurrence field. Native uses an explicit,
visible marker in task notes, validates it, creates successor tasks, and
detects/reconciles divergent duplicate successors. The web task model has no
marker parser, recurrence editor, recurrence worker, or recovery UI.

**Implementation.** Extract a small TypeScript recurrence-marker codec with
the same versioned wire format as native, then add: editor validation; a
subject-scoped recurrence schedule/index; idempotent successor generation at
completion/sync; duplicate/recovery diagnostics; and tests using shared marker
fixtures. Keep the marker human-visible and preserve the user-note portion.

**Decision.** Implement the native versioned marker format exactly in
TypeScript. Maintain shared native/web marker fixtures and conformance tests;
web recurrence is not a separate local-only feature.

**Acceptance.** Never schedule more than one successor for the same completed
occurrence; do not manage assigned/subtask records that native excludes; show
malformed or externally changed markers as recoverable states, not silent data
loss.

#### W-06: Task bulk operations

**Web gap.** Native supports selection plus batch task move, delete, priority,
and text-replace actions with recurrence-aware scope. The PWA exposes only
single-task edits and drag movement.

**Implementation.** Introduce explicit selection state in `TaskPanel`, a
preview/confirmation dialog, and operation-specific outbox records. Apply
optimistic changes in one IndexedDB transaction and flush individual Google
Tasks calls with per-record outcomes; retain failed rows for retry.

**Decision.** Implement the full native batch surface: complete, delete, move,
reparent, set/clear due date, set priority, and recurrence-aware text replace.
W-04 and W-05 define the metadata/marker rules this implementation must use.

**Acceptance.** The UI identifies partial failure and never reports a batch as
wholly successful when any mutation remains pending or failed.

#### W-07: Schedule a task into Calendar and an unscheduled-task view

**Web gap.** Native can link one task to one timed Calendar event, reconcile
external moves/resizes/deletes, and show unscheduled work. The PWA has no
scheduled-task link model or UI.

**Implementation.** Add an IndexedDB `scheduledTaskBlocks` store keyed by
subject/task ID with `calendarId` and `eventId`; create the Calendar event and
link record as one logical operation, then reconcile it during sync. Render an
unscheduled task section and offer `Schedule`, `Move`, and `Unschedule`.

**Decision.** Create an ordinary Google Calendar event and keep the association
only in subject-scoped IndexedDB. Do not write a task marker to the event.

**Acceptance.** Enforce one active link per task locally; repair an orphaned
link rather than silently recreating duplicate Calendar events.

#### W-08: Natural-language quick capture

**Web gap.** Native parses input such as date/time, destination aliases,
priority, and recurrence before creating a task or event. The PWA palette’s
`New task`/`New event` actions open ordinary editors.

**Implementation.** Move the pure parsing contract from
`native/src/core/QuickCaptureParser.*` into a TypeScript parser with fixture
tests. Add a palette action/dialog that shows parsed chips, permits removing a
recognition, and uses IndexedDB-backed defaults for the destination list,
calendar, and event duration.

**Decision.** Port the native parser contract to TypeScript with shared
input/output fixtures. The PWA owns the dialog and browser presentation, while
the parser must preserve native recognition behavior and timezone semantics.

**Acceptance.** Parsing is preview-only until the user submits; ambiguous date
or time input is visible and editable; no system-wide shortcut is added.

#### W-09: Undo/redo and recoverable deletion history

**Web gap.** Native persists bounded undo/recovery state and exposes undo/redo
labels. The PWA has neither an undo stack nor recoverable local deletion state.

**Decision.** Add persisted undo/redo history with reversible local snapshots,
related outbox IDs, expiry, and resource version information. Undo and redo
issue conflict-aware compensating Google mutations even after the original
write has synced. The default retention and maximum-entry values mirror native:
30 days and 200 entries, stored per Google subject.

**Acceptance.** Undo cannot overwrite an externally changed Google resource
without an ETag/conflict decision, and expired history is cleaned up.

#### W-10: Direct calendar manipulation and bulk calendar actions

**Web gap.** Native has drag create, move, resize, event selection, bulk
delete/move/color/availability/visibility/shift/text-replace, and recurrence
scope handling. The PWA presents cards and form-based single-event editing.

**Decision.** Build the time-grid and its accessible pointer/keyboard drag
interactions in-house. It must support drag create, move, resize, selection,
and every native bulk event operation: delete, move, color, availability,
visibility, time shift, and recurrence-aware text replace.

**Acceptance.** Recurring-event operations always ask for instance/this-and-
following/series where Google supports it; a drag cannot change an all-day
event into a timed event without explicit user intent; failed members of a
batch remain inspectable.

#### W-11: Rich Calendar event fields

**Web gap.** Native exposes event color, availability/transparency, visibility,
popup reminders, guest permissions, RSVP comment, and send-updates policy.
The PWA types and API plumbing contain some fields (`reminders`, `visibility`,
`transparency`), but `eventInputFromDraft()` does not populate them and the
editor has no controls. It also has no `colorId`, guest-permission, RSVP
comment, or user-selectable send-updates model.

**Decision.** Expand `GoogleCalendarEvent` and `CalendarEventInput` to every
native-supported Google event field, then expose color, availability,
visibility, popup-reminder overrides, guest permissions, RSVP comment, and
send-updates in a collapsed Advanced section. Preserve all unedited read fields
on PATCH. Popup delivery is defined by W-19; email reminders remain Google-only.

**Acceptance.** Event PATCH must not erase Meet or Drive attachment data;
create/update requests set `conferenceDataVersion=1` when manipulating
conference data and `supportsAttachments=true` when manipulating attachments;
event invitations communicate their email effect before send.

#### W-12: Focus time, out of office, and working-location events

**Web gap.** Native models these Google Calendar status-event types and their
properties. The PWA event types and editor only model ordinary events.

**Implementation.** Add `eventType` and status-property unions to the web
event model, then add a type selector that applies Google’s required field
rules before submission. Only expose choices when the selected primary calendar
and account can use them; otherwise explain why the option is unavailable.

**Decision.** Provide full rendering, creation, and editing for all eligible
Focus Time, Out of Office, and Working Location events on primary calendars.
Do not emulate a Google capability that the account or calendar rejects.

**Acceptance.** Focus time and out-of-office are timed/opaque; working location
is public/transparent and an all-day entry spans one day exactly. The current
Google requirements are documented in the reference link below.

#### W-13: Invitation inbox and RSVP comments

**Web gap.** Native presents a dedicated inbox for `needsAction` invitations
and sends RSVP status plus an optional comment. The PWA can change the signed-
in attendee’s status only after opening an event; it has no inbox or comment.

**Implementation.** Derive an `InvitationInbox` from cached events whose
self-attendee status is `needsAction`; include date/calendar context, action
buttons, and an optional comment editor. Add a dedicated API method with an
ETag/refresh path and an ordinary queued mutation so an offline RSVP is
persisted and retried with the same conflict policy as other event updates.

**Decision.** Derive the inbox from the full canonical event cache and filter
locally, so pending future invitations are independent of the visible range.

**Acceptance.** An action updates the local event after the remote response;
permission failures and conflicting updates remain actionable rather than
silently clearing the invitation.

#### W-14: Structured search parity and saved searches

**Web gap.** The PWA has a strong title-first palette with `type:`, `due:`,
`completed:`, `date:`, and `in:` filters, but native additionally provides
`source:`, `status:`, `start:`, `priority:`, `list:`, `calendar:`, and
`notes:`/`body:` filters, saved searches, and bounded/paginated results.

**Implementation.** Keep the PWA’s title-first/deep-search interaction, but
extend `paletteFilters.ts` and the Calendar worker index with a versioned query
AST. Store saved search name/query pairs subject-scoped in IndexedDB. Add an
explicit "more results" flow rather than silently capping at 12 results.

**Decision.** Preserve the existing PWA filter grammar and add native DSL
aliases. Add saved searches and explicit pagination/more-results behavior
without breaking existing `type:`, `due:`, `completed:`, `date:`, or `in:`
queries.

**Acceptance.** Filters operate only on local cache per keystroke; recurrence
is not expanded merely to search historic events; notes/body search remains an
intentional opt-in deep-search action.

#### W-15: Presentation and planning preferences

**Web gap.** Native persists appearance, density, palette mode, accent, font,
font scale, week start, 12/24-hour time, display zone, work hours, sidebar
size, calendar visibility, and quick-capture defaults. PWA Settings is limited
to connection/sync/privacy controls and the UI has hard-coded visual choices.

**Decision.** Add versioned, per-Google-subject preferences in IndexedDB. Do
not use Drive or another remote settings store. Implement appearance, visual
density, palette mode, accent color, font family/scale, task-list-pane width,
week start, 12/24-hour time, display timezone, work hours, calendar visibility,
sidebar tabs, Notes mode, conflict policy, undo retention/maximum entries, and
quick-capture defaults/aliases. Use CSS custom properties and `Intl`; changing
display timezone must never change stored all-day dates. Do not add the native
external-browser preference because browser links use the user agent.

**Acceptance.** Changing timezone must not alter stored all-day dates; calendar
visibility is independent of Google Calendar-list subscription state.

#### W-16: Import tasks and events

**Web gap.** Native has parse/preview/commit import services with validation.
The PWA has no import route.

**Decision.** Define a new PWA import contract; it does not need wire
compatibility with the native C++ formats, because the C++ product is planned
for deprecation. Support a browser file picker and drag/drop for three local
formats, parse them in a Web Worker, show record-level preview/errors, and
commit accepted records through the normal mutation pipeline. Never upload an
import file to an HCB service.

1. **Delimited UTF-8 text:** one `task` or `event` record per line, followed
   by whitespace-separated `key=value` fields; values may be quoted and use
   `\\n`, `\\r`, `\\t`, `\\"`, and `\\\\` escapes. Task fields are `title`,
   `list`, `due`, `notes`, `priority`, `rrule`, `until`, `count`, `exclude`,
   and `include`. Event fields are `title`, `calendar`, `start`, `end`,
   `all_day`, `time_zone`, `description`, `location`, and `recurrence`.
2. **CSV:** UTF-8 CSV with a required exact header:
   `kind,title,task_list,calendar,due,notes,priority,rrule,until,count,exclude,include,start,end,all_day,time_zone,description,location,recurrence`.
   `kind` is `task` or `event`; unused fields are empty; standard CSV quoting
   applies. The PWA schema intentionally has no native `schema_version` column.
3. **iCalendar:** UTF-8 `VCALENDAR` containing `VEVENT` records. Import
   `SUMMARY`, `DESCRIPTION`, `LOCATION`, `DTSTART`, `DTEND` or `DURATION`,
   `TZID`, `RRULE`, `RDATE`, and `EXDATE`. Reject events without a valid start
   and end; warn and skip unsupported properties such as attendees, alarms,
   attachments, and conferencing rather than silently treating them as imported.

**Limits.** Maximum source size is 5 MiB; maximum accepted records is 1,000;
maximum delimited line is 32 KiB. All records are previewed before any write.
Cancel before confirmation performs no write. A partial commit reports each
pending, succeeded, and failed mutation.

**Acceptance.** Imported all-day and timezone fields use the same rules as the
ordinary event editor. Installed Chromium file associations may be added only
as a feature-detected convenience; the file picker and drag/drop remain the
portable path.

#### W-17: Diagnostics and support export

**Web gap.** Native has structured logging, credential-health diagnostics,
redaction, diagnostic snapshots, and JSON export. The PWA has status strings
but no support bundle or internal state inspection.

**Implementation.** Add a diagnostics page that builds a redacted JSON Blob
for user download. Include app/build version, browser capability checks,
sanitized sync phase/error class, cache counts, storage estimate, pending
mutation counts, and feature flags. Exclude OAuth client ID, account
email/subject, event/task content, tokens, URLs that contain sensitive query
parameters, and raw Google responses.

**Decision.** Produce diagnostics only as a user-initiated local download.
Remote support upload is out of scope for the static PWA.

**Acceptance.** Add tests proving access tokens, Google content, and complete
IndexedDB dumps never appear in the export; make copy/download actions explicit.

#### W-18: Consistent conflict policy and mutation recovery

**Web gap.** Native persists conflict metadata and offers Prefer Google, Prefer
HCB, or Ask each time across sync behavior. The PWA handles `412` conflicts for
single event update/delete with a dialog, while task writes and queued mutations
have no equivalent user policy/recovery surface.

**Decision.** Persist generic conflict records in IndexedDB with local intent,
latest remote record, ETag/version, resource kind, and retry state. Default to
**Prefer Google**. Per-account Settings offers **Prefer Google**, **Prefer
Local**, and **Ask Every Time**. Apply the policy to task, event, and queued
mutations; destructive local overwrite always communicates its effect.

**Acceptance.** A 409/412/410/auth failure is distinguishable in the UI;
resolving one conflict never silently discards another queued mutation.

### Browser-integrated capabilities with explicit limitations

#### W-19: Foreground web notifications for Google popup reminders

**Web gap.** Native converts Google Calendar popup reminders (including calendar
defaults and event overrides) to local notifications with persisted state. The
PWA does not expose reminder controls or deliver notifications.

**Decision.** After W-11 adds reminder configuration, derive popup reminders
from the local occurrence cache only while the PWA is open. Ask for permission
from a user gesture; use `showNotification()` where supported; store
deduplication, Snooze 10 minutes, and Dismiss state in IndexedDB; and route
clicks to the HTTPS event URL. Do not use push, browser-specific scheduled
notification APIs, or closed-app reminders.

**Acceptance.** Email reminders never become browser notifications; denied
permission is non-fatal; reopened tabs do not reissue a dismissed/snoozed
reminder; Snooze is always ten minutes.

#### W-20: Deep links and event URLs

**Web gap.** Native registers `hotcrossbuns://` deep links that can select an
in-app resource. The PWA has no route-level links to cached tasks/events.

**Decision.** Implement same-origin HTTPS routes such as
`/task/<id>` and `/event/<calendarId>/<id>` with safe decoding, local lookup,
and a meaningful signed-out/not-cached state. These links work in every
browser. Add canonical share/copy controls. For installed Chromium PWAs, add a
feature-detected `web+hotcrossbuns` protocol handler as an enhancement. Do not
support the native `hotcrossbuns://` scheme or a wrapper.

**Acceptance.** URLs never include access tokens, raw event content, or client
secrets; unknown/deleted/not-yet-synced records show a recoverable page instead
of failing silently.

#### W-21: Menu-bar/tray-equivalent awareness

**Web gap.** Native provides a system tray/menu-bar integration. Browsers have
no portable system-tray API for a static PWA.

**Decision.** Do not attempt to fake a tray. Use an app-icon badge for pending
mutations/reminders only where `navigator.setAppBadge` is available, and show
the same state inside the app for every browser.

**Acceptance.** The PWA remains fully usable where badges are unsupported;
badge count semantics are documented and never used as the sole notification.

#### W-22: Install/packaging polish

**Web gap.** Native has app bundles, RPM packaging, platform smoke tests, and
release acceptance. The PWA has a manifest and shell service worker but only an
SVG icon; it has no explicit install-quality/test matrix in the repository.

**Decision.** Add 192px and 512px raster/maskable icons, install
documentation, update lifecycle messaging, an install smoke test, and the
browser support policy from W-02. Keep static PWA deployment as the only web
distribution method; do not publish a desktop wrapper.

**Acceptance.** Installed app behaves correctly after update/offline restart;
service-worker caches contain only static assets, never Google API/OAuth data.

## Technical dependencies

- W-04 and W-05 define the local metadata and marker-preservation contracts
  required by W-06 bulk task operations.
- W-08 quick capture reads W-15 per-account defaults.
- W-11 supplies the event reminder configuration consumed by W-19.
- W-10 uses W-11 event fields for rich direct manipulation and bulk edits.
- W-18 generic conflict records are required by W-09 compensating undo/redo.
- W-20 HTTPS event routes are the click target for W-19 notifications.
- W-02 support policy governs W-16 installed file handlers, W-20 protocol
  handlers, W-21 app badges, and W-22 installation checks.

## Required engineering standards for every item

- Maintain the current privacy rule: access tokens remain memory-only unless
  W-01 explicitly authorizes a different architecture. Never add a client
  secret to the browser bundle.
- Keep Google as the source of truth for synchronized fields; label local-only
  metadata and preserve it across normal sync/reconciliation.
- Partition every IndexedDB record by Google OpenID subject and clear all
  subject data on the existing local-data reset path.
- Use a versioned IndexedDB migration for every schema change; add migration,
  rollback/failure, and subject-isolation tests.
- Use `AbortController`, explicit retry classification, and visible error state
  for every new Google operation. Do not rely on a service worker to retain an
  in-memory access token.
- Preserve Calendar recurrence as Google-owned RRULE/EXDATE/RDATE lines and
  use Google-resolved instances for visible ranges; do not build a competing
  recurrence expander for Calendar.
- Add Vitest coverage for domain/storage/API behavior, component tests for
  keyboard and accessibility behavior, and Playwright coverage for a user flow
  whenever it can run without a real Google account.
- Establish web performance budgets before adding a time-grid, bulk selection,
  or broad search expansion. The native benchmarks do not validate browser
  rendering or IndexedDB behavior.

## External constraints and references

- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model): a browser token is short-lived and an expired token must be requested from a user-driven event.
- [Google authorization-model overview](https://developers.google.com/identity/oauth2/web/guides/how-user-authz-works): authorization-code/refresh-token flows require a backend platform for persistent offline access.
- [Google Calendar incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync): retain the final `nextSyncToken`; a `410 Gone` requires clearing the affected cache and full resync.
- [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/guides/create-events): attachment changes require `supportsAttachments=true`; conference changes require `conferenceDataVersion=1`; `sendUpdates` controls invitation email.
- [Google Calendar status events](https://developers.google.com/workspace/calendar/api/guides/calendar-status): focus time, out of office, and working location have required event fields and are capability/account dependent.
- [Service-worker notifications](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification): available in secure contexts after permission; this does not itself schedule future work while closed.
- [Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API): one-off background sync is limited availability and must be feature-detected.
- [Periodic Background Sync](https://web.dev/patterns/web-apps/periodic-background-sync): browser support is limited and it is not a substitute for persistent Google authorization.
- [PWA protocol handlers](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/protocol_handlers): experimental and limited availability; use HTTPS routes as the baseline deep-link mechanism.
- [PWA file association](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Associate_files_with_your_PWA): installed-PWA file handlers/`LaunchQueue` are currently Chromium desktop only.
- [PWA app badges](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon): badges need an installed PWA and have browser/OS support limits.
