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
necessarily mean the feature should be added. Items that would change the
static, user-owned, token-only PWA model are called out explicitly.

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

### P0 — decide the web product boundary first

#### W-01: Unattended sync, persistent Google authorization, and reminders after the tab closes

**Web gap.** The PWA’s access token exists only in `TokenSession` memory and
Google work occurs only while the page has a valid, user-authorized session.
It cannot refresh an expired token or reliably run reminders after every tab is
closed. The native app keeps refresh tokens in the OS credential store and uses
platform reminder delivery; Fedora additionally has a user service.

**Recommended default.** Preserve the existing static PWA trust boundary. Add
only in-tab foreground sync/reminders (W-15) and show a clear reconnect state
after expiry. This is the lowest-risk path and is consistent with
`README2.md` and `docs/architecture/web-pwa.md`.

**Implementation choices requiring a product decision.**

1. **Stay static (recommended).** Use the current Google token model, a
   reconnect button, and in-tab scheduling only. No HCB service stores a
   refresh token. This does not provide true closed-app reminders.
2. **Add an opt-in backend/BFF.** Use Google’s authorization-code flow;
   encrypt and rotate refresh tokens on the service; use Web Push to wake the
   service worker and show a reminder. This changes the product from a static,
   user-owned client to an account-bearing service and requires security,
   retention, incident-response, deployment, and consent design.
3. **Ship a companion native host or wrapper.** Keep the PWA UI but delegate
   refresh tokens, scheduling, notifications, protocol handling, and tray
   behavior to an installed process (Tauri/Electron/custom helper). This
   retains local credentials but is no longer a browser-only PWA.
4. **Use Periodic Background Sync opportunistically.** Feature-detect it only
   as a cache-warming enhancement; it has limited browser support and cannot
   turn an expired in-memory Google token into an unattended authorization.

**Acceptance.** The selected model must document where tokens live, exactly
which component can contact Google while the UI is closed, revocation behavior,
and the browser/platform fallback. Do not put a Google refresh token in
IndexedDB, localStorage, a service-worker cache, URL, or log.

#### W-02: Explicit browser-support policy

**Web gap.** Several desktop-parity paths—push, notifications, file/protocol
handlers, app badges, and background sync—have browser- and OS-specific
support. The current PWA supports any capable static web host but does not say
which advanced-capability browsers are supported.

**Recommended port.** Add a short web support matrix to `README2.md` before
implementing capability-dependent items. Treat the core Tasks/Calendar app as
baseline; progressively enhance Chromium-installed PWAs; expose a browser
fallback in settings rather than silently omitting an action.

**Decision choices.**

- Broad browser support: implement only standard foreground browser behavior.
- Chromium-installed PWA tier: permit file handlers, protocol handlers, and
  app badges where feature detection succeeds.
- Native-wrapper tier: target the desktop app’s integrations through a wrapper
  instead of browser APIs.

### P1 — high-value planner features that fit the current static PWA

#### W-03: Dedicated Notes projection and settings

**Web gap.** Native treats an undated root Google Task as an optional Notes
projection and offers disabled, notes-only, and mirrored modes. The PWA has no
`Notes` view, no projection preference, and no separation between undated root
tasks and normal Tasks.

**Recommended port.** Add a `notesProjectionMode` setting to IndexedDB;
derive notes from tasks with no `due` and no `parent`; add a Notes navigation
surface that reuses the task editor/mutation pipeline. Keep the Google payload
unchanged—there is no separate remote Notes type.

**Decision choices.**

- Mirror the native three states exactly (recommended for parity).
- Ship Notes-only first, then add mirrored Tasks + Notes after testing how
  duplicate presentation affects search and keyboard navigation.

**Acceptance.** Edits, completion, deletion, offline updates, search, and
cross-list moves remain one Google Task mutation; a note with a due date or
parent ceases to qualify for the projection.

#### W-04: Task priority and due-time-zone metadata

**Web gap.** Native supports local task priorities and records due-zone
metadata. The web task model/editor only uses Google’s date-only `due` field.

**Recommended port.** Add a subject-scoped `taskMetadata` IndexedDB store
keyed by `(subject, taskId)` for `priority` and `dueTimeZone`. Display and
filter the metadata locally; never pretend it is a Google Tasks field. Delete
or remap the metadata when a task is deleted or cross-list moved and obtains a
new Google ID.

**Decision choices.**

- Keep metadata local (recommended; matches native’s local-field model).
- Encode metadata in a visible HCB marker inside task notes. This makes it
  portable across clients but complicates user-authored notes and must share a
  parser with W-05.

**Acceptance.** A migration/backfill is idempotent; Google Tasks remains
date-only; metadata cannot leak between Google subjects; palette filters and
task ordering have clear rules for unset priority.

#### W-05: HCB-managed recurring Google Tasks

**Web gap.** Google Tasks has no recurrence field. Native uses an explicit,
visible marker in task notes, validates it, creates successor tasks, and
detects/reconciles divergent duplicate successors. The web task model has no
marker parser, recurrence editor, recurrence worker, or recovery UI.

**Recommended port.** Extract a small TypeScript recurrence-marker codec with
the same versioned wire format as native, then add: editor validation; a
subject-scoped recurrence schedule/index; idempotent successor generation at
completion/sync; duplicate/recovery diagnostics; and tests using shared marker
fixtures. Keep the marker human-visible and preserve the user-note portion.

**Decision choices.**

- Define a shared native/web marker specification and fixtures (recommended).
- Reimplement the native format from source in TypeScript, with cross-product
  conformance tests before shipping.
- Keep web recurrence local-only. This is simpler but would not be portable
  across native and web, and is not feature parity.

**Acceptance.** Never schedule more than one successor for the same completed
occurrence; do not manage assigned/subtask records that native excludes; show
malformed or externally changed markers as recoverable states, not silent data
loss.

#### W-06: Task bulk operations

**Web gap.** Native supports selection plus batch task move, delete, priority,
and text-replace actions with recurrence-aware scope. The PWA exposes only
single-task edits and drag movement.

**Recommended port.** Introduce explicit selection state in `TaskPanel`, a
preview/confirmation dialog, and operation-specific outbox records. Apply
optimistic changes in one IndexedDB transaction and flush individual Google
Tasks calls with per-record outcomes; retain failed rows for retry.

**Decision choices.**

- Start with bulk complete/move/delete (recommended) because they map cleanly
  to current web mutations.
- Add bulk text/priority after W-04 and W-05 establish local-field and marker
  preservation rules.

**Acceptance.** The UI identifies partial failure and never reports a batch as
wholly successful when any mutation remains pending or failed.

#### W-07: Schedule a task into Calendar and an unscheduled-task view

**Web gap.** Native can link one task to one timed Calendar event, reconcile
external moves/resizes/deletes, and show unscheduled work. The PWA has no
scheduled-task link model or UI.

**Recommended port.** Add an IndexedDB `scheduledTaskBlocks` store keyed by
subject/task ID with `calendarId` and `eventId`; create the Calendar event and
link record as one logical operation, then reconcile it during sync. Render an
unscheduled task section and offer `Schedule`, `Move`, and `Unschedule`.

**Decision choices.**

- Create a normal Calendar event whose description carries no task marker and
  keep the association local (recommended; follows native semantics).
- Add a visible HCB marker in the event’s private extended property for
  portability. This is useful only if native also reads/writes the same key and
  requires a cross-client schema decision.

**Acceptance.** Enforce one active link per task locally; repair an orphaned
link rather than silently recreating duplicate Calendar events.

#### W-08: Natural-language quick capture

**Web gap.** Native parses input such as date/time, destination aliases,
priority, and recurrence before creating a task or event. The PWA palette’s
`New task`/`New event` actions open ordinary editors.

**Recommended port.** Move the pure parsing contract from
`native/src/core/QuickCaptureParser.*` into a TypeScript parser with fixture
tests. Add a palette action/dialog that shows parsed chips, permits removing a
recognition, and uses IndexedDB-backed defaults for the destination list,
calendar, and event duration.

**Decision choices.**

- Maintain shared input/output fixtures between C++ and TypeScript
  (recommended).
- Adopt a web-specific parser library. This is faster initially but risks
  behavior drift and needs explicit locale/time-zone ownership.

**Acceptance.** Parsing is preview-only until the user submits; ambiguous date
or time input is visible and editable; no system-wide shortcut is added.

#### W-09: Undo/redo and recoverable deletion history

**Web gap.** Native persists bounded undo/recovery state and exposes undo/redo
labels. The PWA has neither an undo stack nor recoverable local deletion state.

**Recommended port.** Add a subject-scoped `undoEntries` store containing a
reversible local delta, related outbox IDs, expiry, and enough Google resource
identity to issue a compensating mutation. Start with task/event edits and
deletes; show undo only while the operation is still reversible.

**Decision choices.**

- Local UI undo before an outbox item is sent (smallest and safest first step).
- Compensating Google writes after sync (closer parity, but can create a
  conflict and must explain the outcome).
- Soft-delete recoverable rows for a retention period. This requires clear
  storage/cleanup behavior and must not misrepresent Google deletion state.

**Acceptance.** Undo cannot overwrite an externally changed Google resource
without an ETag/conflict decision, and expired history is cleaned up.

#### W-10: Direct calendar manipulation and bulk calendar actions

**Web gap.** Native has drag create, move, resize, event selection, bulk
delete/move/color/availability/visibility/shift/text-replace, and recurrence
scope handling. The PWA presents cards and form-based single-event editing.

**Recommended port.** First replace the web’s list-like day/week presentation
with a time-grid that supports accessible pointer and keyboard move/resize.
Translate an interaction into the existing `updateEvent` path, preserving
event timezone and all-day semantics. Then add selection, preview, and batch
operations backed by a richer event outbox.

**Decision choices.**

- Build the time-grid and interaction model in-house (recommended if visual
  parity and recurrence semantics matter).
- Adopt a maintained calendar interaction library. Audit its keyboard support,
  virtualisation, timezone behavior, React 19 compatibility, and bundle cost
  before committing.
- Ship keyboard/form move and resize first, defer pointer editing.

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

**Recommended port.** Expand `GoogleCalendarEvent` and `CalendarEventInput` to
the Google resource fields; add validated editor controls; preserve read fields
on PATCH; and pass `sendUpdates` intentionally for insert/update/delete. Add a
separate RSVP comment control only after confirming the desired Google API
payload and event permissions.

**Decision choices.**

- Add color/availability/visibility/reminder settings first (recommended; the
  existing web types already establish part of the model).
- Add guest permissions and send-updates with an advanced disclosure to avoid
  overwhelming ordinary event creation.
- Keep email reminders as Google-only configuration and implement web popup
  delivery separately in W-15.

**Acceptance.** Event PATCH must not erase Meet or Drive attachment data;
create/update requests set `conferenceDataVersion=1` when manipulating
conference data and `supportsAttachments=true` when manipulating attachments;
event invitations communicate their email effect before send.

#### W-12: Focus time, out of office, and working-location events

**Web gap.** Native models these Google Calendar status-event types and their
properties. The PWA event types and editor only model ordinary events.

**Recommended port.** Add `eventType` and status-property unions to the web
event model, then add a type selector that applies Google’s required field
rules before submission. Only expose choices when the selected primary calendar
and account can use them; otherwise explain why the option is unavailable.

**Decision choices.**

- Deliver read-only rendering first, then create/edit (recommended).
- Ship a focused status-event editor for primary calendars only, with no
  attempt to emulate unavailable Google Workspace account capabilities.

**Acceptance.** Focus time and out-of-office are timed/opaque; working location
is public/transparent and an all-day entry spans one day exactly. The current
Google requirements are documented in the reference link below.

#### W-13: Invitation inbox and RSVP comments

**Web gap.** Native presents a dedicated inbox for `needsAction` invitations
and sends RSVP status plus an optional comment. The PWA can change the signed-
in attendee’s status only after opening an event; it has no inbox or comment.

**Recommended port.** Derive an `InvitationInbox` from cached events whose
self-attendee status is `needsAction`; include date/calendar context, action
buttons, and an optional comment editor. Add a dedicated API method with an
ETag/refresh path and a queued mutation policy if offline RSVP is supported.

**Decision choices.**

- Use the full canonical event cache and local filtering (recommended).
- Query only the visible range. This is cheaper but fails the inbox expectation
  for future invitations outside the current calendar view.

**Acceptance.** An action updates the local event after the remote response;
permission failures and conflicting updates remain actionable rather than
silently clearing the invitation.

#### W-14: Structured search parity and saved searches

**Web gap.** The PWA has a strong title-first palette with `type:`, `due:`,
`completed:`, `date:`, and `in:` filters, but native additionally provides
`source:`, `status:`, `start:`, `priority:`, `list:`, `calendar:`, and
`notes:`/`body:` filters, saved searches, and bounded/paginated results.

**Recommended port.** Keep the PWA’s title-first/deep-search interaction, but
extend `paletteFilters.ts` and the Calendar worker index with a versioned query
AST. Store saved search name/query pairs subject-scoped in IndexedDB. Add an
explicit "more results" flow rather than silently capping at 12 results.

**Decision choices.**

- Support the native DSL as aliases while retaining existing PWA syntax
  (recommended migration path).
- Replace the web DSL wholesale. This has a simpler final grammar but breaks
  documented PWA behavior and should be a deliberate product change.

**Acceptance.** Filters operate only on local cache per keystroke; recurrence
is not expanded merely to search historic events; notes/body search remains an
intentional opt-in deep-search action.

#### W-15: Presentation and planning preferences

**Web gap.** Native persists appearance, density, palette mode, accent, font,
font scale, week start, 12/24-hour time, display zone, work hours, sidebar
size, calendar visibility, and quick-capture defaults. PWA Settings is limited
to connection/sync/privacy controls and the UI has hard-coded visual choices.

**Recommended port.** Add a versioned `preferences` setting record in
IndexedDB, then implement in this order: week start/time format/timezone;
calendar visibility and work hours; theme/density; quick-capture defaults after
W-08. Use CSS custom properties and `Intl` formatting; do not persist
preferences across Google subjects unless they are deliberately device-wide.

**Decision choices.**

- Per-browser settings, not synced (recommended; matches PWA privacy model).
- Sync settings through a Google-owned document/Drive file. This introduces
  a new remote data contract and should be designed separately.

**Acceptance.** Changing timezone must not alter stored all-day dates; calendar
visibility is independent of Google Calendar-list subscription state.

#### W-16: Import tasks and events

**Web gap.** Native has parse/preview/commit import services with validation.
The PWA has no import route.

**Recommended port.** Add a user-chosen `.csv`, `.ics`, and text file import
workflow using `<input type="file">`; parse in a Web Worker; show a preview with
record-level errors; and commit through the same normal task/event mutation
pipeline. Do not upload import files to an HCB server.

**Decision choices.**

- Browser file picker and drag/drop for all browsers (recommended baseline).
- Add installed-PWA file associations/launch handling on Chromium desktop as a
  progressive enhancement only; current support is Chromium desktop only.

**Acceptance.** Preview must precede remote writes; a partial commit reports
each failed record; parsing cannot execute file content; imported all-day and
timezone fields follow the same rules as ordinary editors.

#### W-17: Diagnostics and support export

**Web gap.** Native has structured logging, credential-health diagnostics,
redaction, diagnostic snapshots, and JSON export. The PWA has status strings
but no support bundle or internal state inspection.

**Recommended port.** Add a diagnostics page that builds a redacted JSON Blob
for user download. Include app/build version, browser capability checks,
sanitized sync phase/error class, cache counts, storage estimate, pending
mutation counts, and feature flags. Exclude OAuth client ID unless explicitly
needed and redact account email/subject, event/task content, tokens, URLs that
contain sensitive query parameters, and raw Google responses.

**Decision choices.**

- User-initiated local download only (recommended).
- Opt-in remote support upload. This creates a backend/data-retention surface
  and is out of scope for the current static PWA.

**Acceptance.** Add tests proving access tokens, Google content, and complete
IndexedDB dumps never appear in the export; make copy/download actions explicit.

#### W-18: Consistent conflict policy and mutation recovery

**Web gap.** Native persists conflict metadata and offers Prefer Google, Prefer
HCB, or Ask each time across sync behavior. The PWA handles `412` conflicts for
single event update/delete with a dialog, while task writes and queued mutations
have no equivalent user policy/recovery surface.

**Recommended port.** Persist generic conflict records in IndexedDB with local
intent, latest remote record, ETag/version, resource kind, and retry state.
Implement the current PWA Ask flow as the default for event mutations, then
extend it to tasks and queued writes. Make policy a W-15 preference only after
the generic resolver exists.

**Decision choices.**

- Ask for every conflict first (recommended; least surprising in a browser).
- Add per-account Prefer Google/Prefer HCB after showing a detailed warning
  about destructive overwrite behavior.

**Acceptance.** A 409/412/410/auth failure is distinguishable in the UI;
resolving one conflict never silently discards another queued mutation.

### P2 — browser-native integrations with explicit limitations

#### W-19: Foreground web notifications for Google popup reminders

**Web gap.** Native converts Google Calendar popup reminders (including calendar
defaults and event overrides) to local notifications with persisted state. The
PWA does not expose reminder controls or deliver notifications.

**Recommended port.** After W-11 adds reminder configuration, derive due
notifications from the local occurrence cache while the PWA is open. Ask for
notification permission from a user gesture; use a service worker’s
`showNotification()` when supported; store deduplication/snooze/dismiss state
in IndexedDB; route clicks to an HTTPS event URL.

**Decision choices.**

- Open-app notifications only (recommended static-PWA scope).
- Service-worker push-backed notifications after closure, which depends on the
  W-01 backend decision.
- Browser-specific scheduled notification APIs, if any. Do not make this the
  core design because it is not portable.

**Acceptance.** Email reminders never become browser notifications; denied
permission is non-fatal; reopened tabs do not reissue a dismissed/snoozed
reminder; snooze duration is configurable or matches native’s ten minutes.

#### W-20: Deep links and event URLs

**Web gap.** Native registers `hotcrossbuns://` deep links that can select an
in-app resource. The PWA has no route-level links to cached tasks/events.

**Recommended port.** Implement same-origin HTTPS routes such as
`/task/<id>` and `/event/<calendarId>/<id>` with safe decoding, local lookup,
and a meaningful signed-out/not-cached state. These links work in every
browser. Add canonical share/copy controls only after defining how much ID
information is acceptable in URLs.

**Decision choices.**

- HTTPS route deep links only (recommended baseline).
- Add a manifest `protocol_handlers` entry using a `web+hotcrossbuns` scheme
  as an installed-PWA enhancement. It is experimental/limited availability and
  cannot be the only path.
- Retain `hotcrossbuns://` via a native companion/wrapper only (W-01 option 3).

**Acceptance.** URLs never include access tokens, raw event content, or client
secrets; unknown/deleted/not-yet-synced records show a recoverable page instead
of failing silently.

#### W-21: Menu-bar/tray-equivalent awareness

**Web gap.** Native provides a system tray/menu-bar integration. Browsers have
no portable system-tray API for a static PWA.

**Recommended port.** Do not attempt to fake a tray. For installed PWAs, add an
app-icon badge for pending mutations/reminders where `navigator.setAppBadge`
is available, and make the status visible inside the app for all browsers.

**Decision choices.**

- App badge plus in-app status (recommended progressive enhancement).
- A wrapper/companion for a real tray menu (requires the W-01 architecture
  decision).

**Acceptance.** The PWA remains fully usable where badges are unsupported;
badge count semantics are documented and never used as the sole notification.

#### W-22: Install/packaging polish

**Web gap.** Native has app bundles, RPM packaging, platform smoke tests, and
release acceptance. The PWA has a manifest and shell service worker but only an
SVG icon; it has no explicit install-quality/test matrix in the repository.

**Recommended port.** Add 192px and 512px raster/maskable icons, install
documentation, update lifecycle messaging, an install smoke test, and the
browser support policy from W-02. Keep static deployment as the primary
distribution method.

**Decision choices.**

- PWA-only distribution (recommended).
- Publish an optional desktop wrapper, with a separate packaging/signing plan.

**Acceptance.** Installed app behaves correctly after update/offline restart;
service-worker caches contain only static assets, never Google API/OAuth data.

## Suggested delivery order

1. Make the W-01 and W-02 product decisions. They govern all closed-app and
   credential-related claims.
2. Add W-03 through W-06 (notes, task metadata/recurrence, batch work). These
   are high-value and fit the existing static PWA boundary.
3. Add W-10 through W-15 (calendar interaction/metadata/status/invites/search/
   preferences). Do W-11 before W-19, because reminder delivery requires a
   real reminder editor and local occurrence model.
4. Add W-07 through W-09 and W-16 through W-18 once a generic metadata,
   outbox, and conflict model is established.
5. Implement W-19 through W-22 only within the support and architecture policy
   chosen in step 1.

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
