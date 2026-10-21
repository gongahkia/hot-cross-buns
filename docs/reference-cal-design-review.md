# Reference-cal presentation study and HCB prototype

Status: design prototype for review. Production integration is awaiting the
user's approval. README.md is outside this work.

## Assessment

Most of reference-cal's presentation can work well for HCB: a quiet navigation
sidebar, restrained typography, a compact date toolbar, the large Calendar
canvas, colored events, and contextual item details. Calendar components can be
reused. Tasks, notes, account management and diagnostics need HCB-specific views
expressed in the same visual language.

Reference-cal is the CalendarCN React/Next.js demo. Its page owns an in-memory
event array and passes callbacks to the Calendar. It supplies no durable storage,
Google synchronization, task model, local notes, or IPC service. HCB already has
those services. Adopting this presentation calls for a renderer adapter and
targeted interaction changes, rather than replacing SQLite or GoogleSyncService.

The local snapshot's package identifies
[vmnog/calendarcn](https://github.com/vmnog/calendarcn) as its origin. Its upstream
[MIT notice](https://github.com/vmnog/calendarcn/blob/main/LICENSE) is retained in
the prototype. The source snapshot did not contain Git metadata, so this review
does not assign it an upstream commit. A file hash manifest records the exact
local files used.

## What was inspected

The review covered these source paths in the sibling `reference-cal` repository:

| Area | Evidence | Implication for HCB |
| --- | --- | --- |
| Shell and state | `src/app/page.tsx`, `layout.tsx`, `globals.css`, `sidebar-left.tsx`, `sidebar-right.tsx` | Reuse the presentation; replace demo page state and account content. Component names for left/right sidebars are counterintuitive, so follow their rendered positions. |
| Calendar rendering | `week-view.tsx`, `week-view-grid.tsx`, all-day row, time axis, current-time indicator, day headers; month view/grid/cells/bars | Strong starting point for day/week/month presentation, overlaps, buffered scrolling and selection. |
| Calendar math | `lib/event-utils.ts`, `calendar-types.ts`, `week-view-types.ts` | Date/end conventions differ from HCB. Preserve HCB's canonical data separately. |
| Interactions | Event drag/resize, all-day resize, month drag/resize, horizontal/vertical scrolling hooks | Most gestures commit through `onEventChange`; add resource capabilities, recurrence scopes, scheduling commands and failure recovery. |
| Details and menus | `event-detail-panel.tsx`, `event-detail-popover.tsx`, `event-context-menu.tsx` | Good visual hierarchy; several actions are display-only. A familiar-looking control is not proof of a working operation. |
| Navigation and theme | Date picker, calendar sources, command menu, view dropdown and theme components | Useful conventions for source toggles, date navigation, search, light/dark and context disclosure. |
| Dependencies and notices | Both package manifests, local-context documents, upstream license | React/Tailwind/Lucide match HCB. Next.js, analytics and Agentation are unnecessary for the Electron renderer. |

HCB evidence includes the current product contract, renderer performance contract,
`CoreScreens.tsx`, `PaneWorkspace.tsx`, `CoreViewModelSource`, Calendar view-model
construction, preload action registrations, MarkdownEditor and its input
dependencies. Existing task/note pagination and Calendar range limits must survive
the redesign.

## Feature mapping

“Prototype” describes sample-data interactions, not production implementation.

| HCB capability | Proposed presentation | Prototype | Production connection after approval |
| --- | --- | --- | --- |
| Calendar day/week/month/agenda | Reference Calendar canvas and compact date toolbar | Actual reference day/week/month components; an HCB-style agenda | Existing Calendar range loader and event view models |
| Multiple accounts and sources | Grouped account/calendar checkboxes in navigation | Three independently filterable sample sources | Account/source IDs, visibility preferences and read/write capabilities |
| Event create/edit/delete | Click a slot; open details for the selected item | Sample forms and empty-slot creation; sample drag/resize | Existing calendar mutations; validate before queueing; retain Google revisions |
| Time zones, all-day and recurrence | Existing fields in compact inspector; scope dialog for recurring changes | Browser-local dates, inclusive demo all-day range, recurrence text | HCB's displayed zone, event zone, exclusive date ends, occurrence IDs and recurrence-scope commands |
| Tasks and one-level subtasks | List or board, filters, duration, priority and inspector | List/board, filtering, priority order, one-level indentation, edit/complete/delete guard | Keep measured virtualization, paging, tree restrictions, stars and list-order preferences |
| Scheduling and task blocks | Task actions and scheduling review, without a permanent day panel | Sample free-slot preview and linked blocks, reached through Tasks or search commands | `scheduleSuggest`, `scheduleTaskBlock`, `moveScheduledTaskBlock`, `unscheduleTaskBlock`; keep due dates separate |
| Smart Schedule and rescheduling | Review proposed placements and their scope | A small demo-only gap finder, limited to three tasks | Existing deterministic planner, working hours and smart-reschedule review; no new planner algorithm |
| Local notes and lists | A slim note collection beside a document page | Search/filter notes, preview, create, shared rich/source editing | Paged note metadata, full-record fetch, existing autosave/error recovery and note-list mutations |
| Markdown on every editing surface | Same editor in the document, inspectors and capture dialog | Imports the actual HCB MarkdownEditor | Retain the shared editor and HCB preview/reference behavior |
| Item references and Drive links | Reference controls inside existing editor | Rich/source editing works; live reference search/upload is absent | Keep existing stable links, lazy embeds, optional scopes, file picker/upload and current account boundaries |
| Search and commands | One command/search overlay | Keyboard navigation across sample tasks, notes, events and commands | Existing bounded SQLite lexical search and native command registry |
| Quick capture | One New dialog with task/event/note tabs | Creates sample records | Existing validations, durable mutation results and OS capture shortcut |
| Split workspace | Adjacent note/reference pane | One additional note or static reference pane, pause/resume illustration | Keep current four-pane model, saved layouts, resizing and web-tab process lifecycle |
| Sync status and recovery | Persistent status strip; open a clear comparison | Explicit sample local/Google comparison and related-edit count | Existing reviewed recovery endpoints, revision guards, queue and sync mode |
| Optional Google integrations | Account settings and contextual entry points | Placement described in settings | Keep existing Gmail capture, Drive access and reviewed account-copy flows; preserve scope checks |
| Appearance and preferences | Neutral light/dark shell, compact settings | Theme switching and sample settings | Map HCB's full theme catalog, keyboard preferences, source visibility and device preferences |
| Local backups and recovery | Data settings, close to local-note ownership | Ownership explanation and sample-data reset | Existing backup/export/recovery service; sample reset is not a backup feature |
| Native desktop and diagnostics | Shell commands, status and settings | Browser illustration only | Preserve menu/tray, notifications, deep links, startup, platform capabilities, performance diagnostics and undo/redo |

## Boundaries that prevent a direct drop-in replacement

1. **All-day ends differ.** The reference month layout adds a day to an all-day
   event's end; its all-day filtering includes the end date. HCB's Calendar data
   uses an exclusive end. Convert only at the display boundary and reverse that
   conversion for edits. Do not change stored dates to make the component fit.
2. **The viewer's zone differs from the browser's zone.** Reference math uses
   local `Date` operations and `date-fns` clock fields. HCB supports a separately
   selected display zone and preserves the event's recurrence zone. The adapted
   layout needs zone-aware coordinates and explicit conversion for drag/resize,
   including DST gaps, folds and midnight boundaries. A label change is insufficient.
3. **A calendar tile is not always a normal event.** Carry a projection key plus
   the canonical HCB ID, account, calendar, occurrence and task-block identity.
   Route task-block gestures through scheduling APIs and recurring-event changes
   through the existing scope flow. Do not write a whole rendered object back.
4. **A displayed field is not necessarily editable.** Reference event menus
   contain cut/copy/duplicate/delete entries without corresponding behavior, and
   some guest/conferencing/recurrence rows are presentation only. Bind each
   operation to a real command or omit it. Read-only and unavailable capabilities
   need visible states before production use.
5. **UI state cannot become a second database.** Keep bounded source caches,
   pagination, full-record fetches for editors, and worker-owned recurrence and
   search. The prototype's arrays and gap finder are disposable design scaffolding.
6. **A successful gesture is not a successful sync.** Queue through existing
   mutations, retain pending/conflict indicators, handle durable failure, and keep
   reviewed conflict recovery. Never import demo callback behavior into delivery.
7. **Editor drafts and native behavior must survive.** Preserve current autosave,
   failed-save recovery, composition guards, editor undo, app undo, split layouts,
   keyboard routing, and paused embedded pages. Next.js is unnecessary here.

## Prototype implementation

The isolated app is in `prototypes/reference-cal`. Its independent manifest and
lockfile leave HCB's dependency graph unchanged. It runs Vite on
`http://127.0.0.1:4177`:

```sh
corepack pnpm --dir prototypes/reference-cal install --frozen-lockfile
corepack pnpm --dir prototypes/reference-cal dev
```

The root HCB dependencies must also be installed, because the prototype imports
HCB's shared MarkdownEditor. Thirty-five calendar source files were copied
unmodified into `src/vendor`. `vendor-manifest.json` records their source hashes.
The adapted reference stylesheet and new HCB shell are outside that directory.
The prototype does not include Next.js, analytics, Agentation, cloud credentials,
a preload bridge or Google transport. It serves only on loopback.

Sample changes live in the current tab. Reload resets them. The reset control
restores the fixture; neither action affects an HCB profile. A sample reference
page demonstrates layout and pause/resume; it does not mount an actual webview.
Calendar right-click demo menus and event popovers are suppressed in favor of
the HCB sample inspector, so upstream placeholder actions are not offered.

## Proposed integration sequence after approval

1. Adopt the shell tokens, navigation, toolbar and context-panel hierarchy inside
   the existing Electron renderer, initially behind a reversible UI switch.
2. Add a typed Calendar projection/command adapter. Verify time zones, all-day
   ends, recurrence identity, read-only sources and task-block routing before
   enabling mutations. Render through existing bounded range loading.
3. Bind task and note layouts to existing paged controllers and inspectors. Retain
   the shared editor and save recovery instead of transferring prototype state.
4. Connect quick capture, indexed search, scheduling review, sync status and
   diagnostics to their existing commands. Carry pending/error states through
   every affected surface and remove all demo labels/data.
5. Restyle the current multi-pane workspace and settings, preserving native
   capabilities and optional-integration boundaries. Verify keyboard, composition,
   focus, busy/empty/error states and scale before switching the default UI.

No database migration is indicated by this presentation study. Any backend
change discovered during integration should solve a specific API gap and have
its own regression test and atomic commit.

## Interface review

Full review scope: the prototype's Calendar, tasks, notes, inspectors, dialogs,
search, settings, split view and responsive shell. Framework: React, Vite,
Tailwind 4, existing Lucide/Radix conventions and plain component CSS, matching
the reference's existing stack. This is a design review, not production acceptance.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Light Calendar screenshot, task and document styles, reference token definitions | Neutral hierarchy, inherited font stack, tabular times and counts; inherited compact/past-event readability needs production review |
| Surfaces | Sidebar, date toolbar, docked context, modal forms, empty results, selected sources and theme states | Structural dividers, limited elevation and visible focus; main desktop controls use 40px targets. Compact context/mobile controls and inherited tiles remain a production hit-area review |
| Animations | Reference scroll transitions, modal classes and reduced-motion rule | Reference has 200ms scroll transforms; no new entrance or routine menu animation. Replay results are recorded in the verification section |
| Icons | Shell, inspectors, settings and shared editor | Lucide/currentColor retained; no second icon library |
| Performance | Standalone build output, dependency boundaries and in-memory fixtures | Rich editor deferred; prototype is unoptimized and not a scale or startup benchmark |

| Severity | Location | Before | After / required action | Why |
| --- | --- | --- | --- | --- |
| HIGH | Reference `src/app/page.tsx:100` → prototype `src/App.tsx:18` | Only demo calendar state existed | Add HCB task/note/day-panel flows and label sample state; bind only after approval | Navigation must account for the whole product |
| HIGH | Reference `src/components/event-detail-panel.tsx:793`, `event-context-menu.tsx` | Familiar menus included inert operations | Prototype uses working sample forms and suppresses the unused menus; production needs command/capability binding | Avoid misleading controls |
| HIGH | Reference `src/lib/event-utils.ts:136`, `src/components/week-view.tsx:212` | A direct data swap would shift zones or span extra dates | Document required adapter and keep real data disconnected | Preserve calendar meaning before enabling writes |
| HIGH | Prototype `src/Inspectors.tsx:26`, `src/Dialogs.tsx:29`, `src/model.ts:70` | Calendar-only event callbacks cannot express HCB task scheduling | Separate tasks, blocks, due dates and reviewed placements | A task due date must not silently become its work time |
| MEDIUM | Prototype `src/Inspectors.tsx:26`, `src/App.tsx:146` | A saved task draft could reverse completion; event inspector could retain a pre-drag time | Preserve current completion on save and refresh the event draft after time changes | Keep visible edits consistent with the sample calendar |
| MEDIUM | Prototype `src/Documents.tsx:9`, `src/Dialogs.tsx:12`, `src/Inspectors.tsx:26` | Independent mock editors would diverge from HCB | Reuse HCB's actual rich/source editor in every editable body | Keep editing interactions consistent |
| MEDIUM | Prototype `src/ui.tsx:9`, `src/prototype.css:36`, `src/Dialogs.tsx:48` | Reference's compact controls included small targets and disclosure gaps | Main desktop controls use 40px targets, named actions, focus cues, trapped dialogs and keyboard search; compact targets remain for production review | Make the new shell reachable by pointer and keyboard |
| MEDIUM | Prototype `src/App.tsx:73` | Changing to Month and back lost the previously focused week | Keep the focused date separate from the render anchor | A view change should preserve planning context |
| MEDIUM | Prototype `src/App.tsx:25`, `src/App.tsx:108`, `src/prototype.css:390` | Sidebars could obscure a small Calendar; the scrim was the only close target | Start compact windows with panels closed; add a visible close control and dismiss navigation after selection | Preserve usable canvas width and a clear exit |
| HIGH | Reference `src/components/calendar-event-item.tsx:477` → prototype `src/prototype.css:131` | Calendar tiles explicitly suppressed focus outlines | Add a visible keyboard focus ring without modifying the vendor source | Keyboard navigation must show the focused event |
| MEDIUM | Reference `src/components/calendar-event-item.tsx:517` and prototype compact controls | Half-hour tiles can be short; past events fade strongly | Retained for visual evaluation; production must assess contrast, targets and pointer/keyboard access across event densities | Compact calendar presentation needs a usable alternate path |
| MEDIUM | Prototype `src/model.ts:43`, `src/App.tsx:18` | Arrays and broad imports are convenient for a sketch | Keep out of production; integrate bounded HCB queries and lazy surfaces | Do not regress the current scale contract |

Considered and rejected:

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Entire application | Move HCB into the reference Next.js app | Adds a framework boundary without providing persistence or sync |
| Calendar | Rebuild an approximate calendar from scratch | Actual reference components give a more faithful, faster design evaluation |
| Prototype notes | Create a separate simplified editor | Would obscure the behavior of the shared HCB editor already implemented |
| Prototype wiring | Connect the demo immediately to a real HCB profile | User approval is explicitly required before integration; sample arrays make design changes inexpensive |

## Initial verification on 2026-10-21

| Check | Observed result |
| --- | --- |
| `pnpm --dir prototypes/reference-cal typecheck` | Passed, including imported HCB editor source |
| `pnpm --dir prototypes/reference-cal build` | Passed; editor remains a deferred chunk. Vite reports large prototype chunks; this is not a production performance claim |
| Root `pnpm typecheck` and `pnpm typecheck:core` | Passed; root app source, dependencies and configuration are unchanged |
| Calendar source filtering and four views | Passed in Chrome |
| Task list/board, title edit, completion and Markdown notes | Passed; saving preserves the current completion state |
| Note preview, create, edit, Visual/Source round trip | Passed using the actual HCB editor |
| Split notes/reference, sample pause/resume | Passed |
| Schedule preview and apply; task drag onto Calendar | Passed; each drag opens review before creating a sample block |
| Conflict comparison and sample resolution; keyboard search | Passed |
| Theme switching, account boundary, shortcut settings and sample reset | Passed |
| 1024px and 390px layouts | No document/toolbar horizontal overflow; compact panels start closed, and the navigation close control works |
| Browser errors and external data requests | None during the final 12-check walkthrough |
| Vendor provenance | All 35 file hashes match both the manifest and the sibling source |

The browser walkthrough used disposable headless Chrome contexts and captured
screenshots in `output/reference-cal`. Desktop light/dark, task board, note
preview/editor, split notes, schedule comparison, conflict review and phone
screenshots were inspected. Phone Calendar readability remains limited in the
seven-column week layout; the Day view is the usable alternative. This is a
desktop-first presentation study, not a mobile acceptance claim.

The supplementary Chrome walkthrough also passed:

- Month → Week retains the focused week.
- Dragging a reference Calendar event changes its time and refreshes the docked
  inspector's fields.
- An invalid end time produces an inline error; correcting it allows saving.
- Empty search results and Escape dismissal remain usable.
- The period transition was replayed with Chrome's animation playback rate at
  10%; intermediate and resting screenshots were inspected.
- With reduced motion enabled, transformed Calendar elements receive the
  shortened transition duration.

No renderer errors occurred in those six checks. The browser interaction scripts
were temporary review tools, not additions to HCB's production regression suite.

**Verdict: Block as a production replacement; ready for visual review.** The
high-severity zone/end-date, identity, capability and real-command integration
requirements still need implementation after approval. Inherited compact targets,
past-event contrast and bundle/collection scaling also need production work.
Manual screen-reader use, OS-native composition in this browser shell, dense
calendar datasets, DST behavior, advanced account features and live Google
behavior were not verified. Those are not implied by the sample walkthrough.

The user is approving the visual direction and navigation model at this stage.
No production backend, preload, renderer source, root dependency manifest or
README.md was changed to deliver the prototype.

## Revision: remove the default day panel

Following visual feedback, the permanent right-hand day summary has been removed,
including its progress bar, Up next, task/agenda tabs, planning card and tips. The
Calendar and Tasks now use the available width. A task or event selection opens
its detail inspector as an overlay, keeping Calendar coordinates stable while
the pointer is down. Closing, deleting or deselecting the item removes the
inspector and reveals the unobstructed main view. Split
notes/reference remains an explicit toolbar action.

The day-panel toggle and its unused component/styles were removed. Scheduling
remains available from Tasks, the task inspector and search commands. The prior
drag-from-day-panel walkthrough is historical; that source panel is no longer
part of the approved design revision. This feedback revises the prototype and
does not authorize production integration yet.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `prototypes/reference-cal/src/App.tsx`, `Inspectors.tsx`, `prototype.css` | A day summary permanently occupied 308px and duplicated task/agenda content | Show the contextual inspector only for a selected item, with explicit close controls | Follow the requested visual hierarchy and give the Calendar more room |
| HIGH | `prototypes/reference-cal/src/prototype.css` | Opening docked details during the reference Calendar's pointer-down selection shifted the clicked event before pointer-up | Overlay details without changing Calendar dimensions | A click or drag must retain the intended event under the pointer |

| Category | Revision evidence | Result |
| --- | --- | --- |
| Typography | Revised Calendar screenshot and task guidance | Existing text styles retained |
| Surfaces | Main Calendar width, selected details and split workspace | Default Calendar uses the full available width; selection uses an overlay |
| Animations | Removed day-panel styles and inspector layout | No new animation; Calendar coordinates remain stable during selection |
| Icons | Toolbar and inspector close controls | Removed day toggle; existing Lucide X closes details |
| Performance | Component removal and revised build | Less initial UI and CSS; no scale-performance claim |

Considered and rejected: keeping a hidden day panel behind its old toggle (would
retain the removed feature), and deleting all item inspectors (would remove the
existing editing path).

Verification: prototype TypeScript and production build passed. Chrome checks
confirmed the full-width default Calendar; event selection/closing on all five
weekdays without shifting the grid; task inspector opening/closing; scheduling
review from Tasks; split workspace; light/dark and 390px layouts; and no renderer
errors. Screenshots are in `output/reference-cal/no-day-panel.png` and
`no-day-panel-dark.png`.

Revision verdict: **Approve within this removal's scope.** The production
integration requirements and unverified checks in the earlier review remain.
