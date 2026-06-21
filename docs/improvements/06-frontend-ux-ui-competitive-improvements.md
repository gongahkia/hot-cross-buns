# Frontend UX/UI Competitive Improvements

## Comparison Basis

Competitive references researched on May 22, 2026:

| Product | Source and screenshot reference | Patterns to study | Hot Cross Buns 2 takeaway |
|---|---|---|---|
| Linear | [Concepts](https://linear.app/docs/conceptual-model), [Display options](https://linear.app/docs/display-options), screenshot artifacts in `output/competitive-research/screenshots/linear-*.png` | Command menu, keyboard-first action model, contextual menus, bulk selection, display options, board/list/timeline toggles | Build one consistent action system. Every visible task/event action should also be reachable through command palette, keyboard paths where present, and future context/bulk actions. |
| Notion | [Views, filters, sorts and groups](https://www.notion.com/help/views-filters-and-sorts), screenshot artifact `output/competitive-research/screenshots/notion-database-views.png` | Saved database views, per-view property visibility, filters, sorts, groups, side peek and center peek editing | Treat planner screens as configurable views over local data, not fixed pages. Editing details should preserve list/calendar context. |
| Notion Calendar | [Product page](https://www.notion.com/en-US/product/calendar), screenshot artifact `output/competitive-research/screenshots/notion-calendar.png` | Schedule glanceability, availability links, time zones, multiple calendars, drag/drop database dates, command menu | Calendar work should show tasks and events together, make conflicts visible, and keep drag/drop/date edits behind local mutation contracts. |
| TickTick | [Product page](https://ticktick.com/?language=en_us), screenshot artifact `output/competitive-research/screenshots/ticktick-features.png` | To-do list, calendar views, agenda, kanban, timeline, Eisenhower matrix, Pomodoro, habits, countdowns | A planner should support different work modes without fragmenting data. Add task/calendar views incrementally, with habits/focus tools as explicit backlog. |
| Sorted3 | [How it works](https://www.sortedapp.com/how-it-works), [Auto Schedule](https://www.sortedapp.com/blog/auto-schedule), [Magic Select](https://www.sortedapp.com/blog/magic-select), screenshot artifact `output/competitive-research/screenshots/sorted3-how-it-works.png` | Unified daily schedule, auto-schedule, realistic capacity, buffers, batch rescheduling, Time Ruler, Magic Select | Today should evolve into a time-blocking timeline with task durations, capacity, locked events, flexible rescheduling, and suggested scheduling. |
| OmniFocus 4 | [Perspectives manual](https://support.omnigroup.com/documentation/omnifocus/universal/4.8.10/en/perspectives/), screenshot artifact `output/competitive-research/screenshots/omnifocus-perspectives.png` | Inbox, Projects, Tags, Forecast, Review, perspective bar, Quick Open, outline navigation | Add serious task triage through perspectives, tags/projects, forecast/review flows, and outline/inspector editing. |
| Obsidian | [Core plugins](https://obsidian.md/help/plugins), [Backlinks](https://obsidian.md/help/plugins/backlinks), [Graph view](https://obsidian.md/help/plugins/graph), [Canvas](https://obsidian.md/help/plugins/canvas), [Properties](https://obsidian.md/help/properties), screenshot artifact `output/competitive-research/screenshots/obsidian-core-plugins.png` | Local-first notes, backlinks, unlinked mentions, graph, canvas, properties, command palette, quick switcher | Notes should become linked planner knowledge. Backlinks and properties come before graph/canvas because they support everyday planning. |

The screenshot artifacts are local research captures only. Do not ship, copy, or restyle competitor screenshots as Hot Cross Buns 2 product assets.

Current Hot Cross Buns 2 basis:

- `src/renderer/src/App.tsx`
- `src/renderer/src/features/core/CoreScreens.tsx`
- `src/renderer/src/features/core/coreViewModelSource.tsx`
- `src/renderer/src/components/CommandPalette.tsx`
- `src/renderer/src/components/primitives.tsx`
- `src/renderer/src/styles/index.css`
- `docs/design/design-system.md`

Hot Cross Buns 2 already has a compact Electron/React shell, sidebar navigation, command palette, Today, Tasks, Calendar, Notes, Search, Settings, diagnostics/status states, local cache awareness, typed IPC, and renderer timing hooks. The frontend gap is not another landing page or decorative redesign. It is missing the mature productivity-app interaction model: fast capture, configurable views, inspect-in-place editing, dense timelines, reliable keyboard/mouse parity, and local-first planner context.

## Competitive UX Principles

### 1. One Action System

Linear's strongest transferable pattern is not its visual style; it is action consistency. A user can act through buttons, keyboard shortcuts, context menus, bulk selection, or command menu search.

Hot Cross Buns 2 should add an internal action registry that powers:

- toolbar buttons
- row actions
- command palette commands
- future context menus
- future bulk-selection menus
- disabled states and reason text
- telemetry-friendly action IDs

Acceptance checks:

- Creating, editing, completing, reopening, moving, deleting, refreshing, searching, and opening settings use stable action IDs.
- Command palette exposes the same core task/calendar/navigation actions as visible controls.
- Disabled actions show a clear reason without throwing or silently disappearing.
- Renderer tests cover action availability for loading, empty, offline, stale, and ready states.

Status on 2026-05-23:

- Implemented a renderer action registry in `src/renderer/src/actions/plannerActions.ts` for task create/quick capture/selected task actions, calendar create/view actions, note create, navigation, search syntax discovery, sync refresh, MCP, and diagnostics.
- Command palette entries now use the same action IDs as the visible controls, include disabled-state reason text, and gate task/calendar writes when cached resources or selected-item context are unavailable.
- Visible task, calendar, note, settings, diagnostics, and refresh controls now carry matching `data-action-id` attributes for testing and future telemetry/context-menu reuse.
- Selected task context is currently local to the Tasks screen toolbar. Palette-scoped selected-item execution remains deferred until the shell owns a shared selected-item context.

### 2. Configurable Views Over One Local Model

Notion and Linear both make views configurable: filters, sorts, grouping, layout, visible properties, and per-view display settings. OmniFocus uses perspectives for purposeful slices like Inbox, Forecast, and Review.

Hot Cross Buns 2 should treat Today, Tasks, Calendar, Notes, and Search as view projections over one local planner model. Saved views should be local settings or local database rows, not a second planner data store.

Add view settings in this order:

1. Display density and visible properties for task/event rows.
2. Sort and group options for task lists.
3. Saved filters/perspectives for common task and planner slices.
4. Calendar layout and time-range preferences.
5. Per-view open behavior: inline inspector, modal, or full section.

Acceptance checks:

- View settings survive restart.
- Saved views do not duplicate task/event/note records.
- Search/filtering stays local-first and never calls Google per keystroke.
- View preferences can reset to defaults without deleting planner data.

### 3. Preserve Context While Editing

Notion side peek, OmniFocus inspectors, and Linear side/context panels reduce navigation churn. Hot Cross Buns 2 currently has screen-specific forms and panels, but it needs a consistent detail inspector pattern.

Add a shared inspector shell for selected task, event, note, settings item, and diagnostic item details:

- right-side inspector on desktop-width windows
- modal fallback for narrow windows
- stable close/back behavior
- dirty-state protection for unsaved edits
- consistent save/cancel/delete affordances
- command palette actions scoped to the selected item

Acceptance checks:

- Selecting a row opens details without losing scroll position or active filter.
- Closing the inspector returns focus to the invoking row.
- Unsaved edits warn before losing local changes.
- The inspector works with keyboard-only navigation.

### 4. Timeline First, Not Card Wall

Sorted3, TickTick, and Notion Calendar all emphasize schedule comprehension. Hot Cross Buns 2 should make Today the main work surface, with a dense unified timeline instead of loosely related panels.

Evolve Today into:

- all-day lane
- timed event blocks
- scheduled task blocks
- unscheduled task inbox lane
- conflicts and over-capacity markers
- focus/current-time indicator
- quick-add at time
- drag/drop or keyboard move once backend support exists

Backend support required:

- task planned date/time separate from due date
- task duration estimate
- task locked/manual scheduling flag
- task snooze/defer date
- conflict query helper
- local scheduling suggestion service

Acceptance checks:

- Today can show tasks and events in one chronological model.
- All-day and timed items remain visually distinct.
- Locked calendar events cannot be auto-rescheduled.
- Unsynced local scheduling changes are surfaced through existing pending-mutation status.

### 5. Notes Are Planner Knowledge

Obsidian's transferable value is not a graph visual in v1. It is a local-first link model that makes notes, tasks, and events discoverable from each other.

Add note improvements in this order:

1. Markdown preview and split/edit mode.
2. Link syntax for notes, tasks, and events.
3. Backlinks panel for the selected note/task/event.
4. Note properties such as status, tags, project, related date, and source.
5. Daily note or meeting note templates.
6. Local graph/canvas as backlog after links and backlinks are real.

Backend support required:

- local link table for note-to-note, note-to-task, note-to-event, and inferred unlinked mentions
- note properties table or JSON field with indexed common properties
- FTS refresh path for markdown body and properties

Acceptance checks:

- Backlinks update after editing a note.
- Broken links are visible and recoverable.
- Notes stay usable offline.
- Graph/canvas is not promised until link data and performance are stable.

## Improvements To Add

### 1. Frontend Shell And Navigation Polish

Bring the shell closer to high-end productivity products while preserving the current compact design system.

Add:

- persistent section title, quick actions, and display controls per screen
- command palette categories based on active section and selected item
- sidebar counts that do not resize or shift navigation
- clear keyboard focus treatment for sidebar, rows, toolbar, inspector, and modals
- responsive fallback for the current two-column content plus support sidebar layout
- consistent empty/loading/offline/error/stale states across every screen
- row hover/selected/focus states that use the same tone language

Acceptance checks:

- `Tab`, arrow navigation where implemented, `Enter`, `Escape`, and command palette flows are testable.
- No toolbar, row, or badge text overflows at compact desktop widths.
- Today, Tasks, Calendar, Notes, Search, Settings, and command palette have manual smoke coverage.

### 2. Today Unified Timeline

Use Sorted3's scheduling clarity, TickTick's agenda model, and Notion Calendar's glanceability as the target.

Add:

- timeline rows grouped by all-day, morning, afternoon, evening, and unscheduled when full time-grid work is too large
- duration chips for tasks when estimates exist
- current-time marker and "next up" affordance
- conflict marker when task blocks overlap fixed events
- quick add that can create unscheduled task, scheduled task, or note from one compact surface
- suggested schedule section only after local scheduling helpers exist

Do not:

- Build a full AI scheduler in this pass.
- Move Google events directly from renderer.
- Hide conflicts behind decorative UI.

Acceptance checks:

- Today remains useful with no Google connection.
- Large local task/event fixtures do not cause unbounded DOM growth.
- Timeline state is derived from cached local data.

Status on 2026-05-23:

- Today now groups cached event/task timeline rows into all-day, morning, afternoon, evening, and unscheduled sections and uses the existing virtualized list path.
- Task quick-add and detail flows now carry planned time, duration, locked schedule, and tags, while the local schedule suggestion service surfaces capacity/conflict evidence in Today.

### 3. Task Power Surface

Combine Linear's multi-path actions, OmniFocus perspectives, and TickTick's task modes.

Add:

- bulk selection and batch complete/reopen/delete/move where mutation queue support exists
- task inspector with title, notes, due, planned, priority, list, parent, tags, and pending status
- hierarchy expansion/collapse and cycle-safe parent moves
- perspectives for Inbox, Forecast, Review, Tags, and Projects once data exists
- kanban/grouped views only as projections over local task rows
- natural-language quick add as a local parser that produces ordinary task create requests

Acceptance checks:

- Bulk actions enqueue one safe domain request per affected item.
- Child task editing cannot create parent cycles.
- Natural-language parsing is optional and never blocks plain task creation.
- Saved task perspectives can be reset without deleting tasks.

### 4. Calendar Planning Surface

Use Notion Calendar and TickTick as references for dense planning, not as branding references.

Add:

- agenda, day, week, and month layouts with stable display controls
- quick-create at date/time
- event inspector with guests, reminders, location, recurrence summary, and sync status
- multiple calendar visibility controls
- time-zone display affordance once backend date handling is explicit
- drag/drop only through safe local update requests and pending mutation status

Acceptance checks:

- Day/week views virtualize or window large event sets.
- Month view uses derived day indexes rather than scanning all events in renderer.
- Time-zone labels are unambiguous.
- Calendar edits preserve local/offline status visibility.

Status on 2026-05-23:

- Calendar now has agenda/day/week/month controls, quick-create from day/week/month cells, event edit forms hosted in the global Inspector with guests/reminders/location/notes/recurrence, timezone labels, per-screen calendar visibility controls, event pending-mutation badges, and drag/drop move/resize gestures backed by typed local update requests.
- Day view uses the shared virtualized list pattern for hour rows; week view uses a windowed column path; month view reads from derived day indexes rather than scanning all events per cell.

### 5. Search, Filters, And Perspectives

Use Linear filters, Notion view settings, OmniFocus perspectives, and Obsidian search as the combined target.

Add:

- visible filter chips for source, status, date windows, priority, list/calendar, tags, and body/notes presence
- invalid-query feedback that does not clear the previous result set unexpectedly
- saved search views after parser and matcher behavior are stable
- command palette discoverability for saved views
- display controls that distinguish filtering from property visibility

Acceptance checks:

- Plain text search and structured filters can coexist.
- Filters operate entirely on local cached data.
- Saved views have stable IDs and names.
- Search handles empty, invalid, loading, stale, and offline states consistently.

Status on 2026-05-23:

- Implemented visible chips and inline invalid-query feedback for the initial local Search DSL: source/domain, task status, due/start windows, priority, list/calendar title, and notes/body presence.
- Added command palette discovery for local search filter syntax.
- Saved search views are now stored as typed local settings with stable IDs, names, queries, and timestamps, and can be saved, replayed, or deleted from the Search screen.

Additional frontend polish status on 2026-05-23:

- Calendar week/month cells and event chips now respond to keyboard activation, opening create/edit flows without requiring pointer input.
- Focused renderer coverage now includes shared action IDs, command palette action availability, and keyboard creation from calendar grid cells.

### 6. Notes And Linked Planning

Use Obsidian as the note interaction reference.

Add:

- markdown preview and edit mode
- note properties UI
- backlinks/right inspector panel
- link autocomplete for notes, tasks, and events
- daily note and meeting note creation commands
- future graph/canvas backlog gated by link-table readiness and renderer performance

Acceptance checks:

- Note edits update local search and backlinks.
- Link autocomplete does not query Google.
- Broken links are visible and repairable.
- Markdown rendering is sanitized.

Status on 2026-05-23:

- Notes now edit through the global Inspector with markdown preview, note links/backlinks, visible broken note links, task/event link syntax, local autocomplete insertion across notes/tasks/events, keyboard-activatable link chips, inferred property chips from note-body metadata, and daily/meeting note templates.

### 7. Settings And Diagnostics UX

Settings and diagnostics should communicate system state as clearly as productivity apps communicate task state.

Add:

- sections for Local data, Google sync, Native integrations, Notifications, MCP, Privacy, Performance, and Developer diagnostics
- capability rows with state, last checked time, remediation action, and copy-safe details
- sync queue status with counts by pending/applying/failed/applied
- privacy summary that states local cache and credential boundaries
- copy diagnostics action that redacts secrets by default

Acceptance checks:

- A preview user can understand why sync, notifications, tray, shortcut, protocol link, or MCP is unavailable.
- Diagnostics never expose raw OAuth tokens, MCP bearer tokens, or raw Google payloads.
- Settings reset actions are scoped and reversible where possible.

Status on 2026-05-23:

- Settings now exposes required sections for Google, resources, sync, appearance, hotkeys, tray, notifications, local data, MCP, platform, and diagnostics; Sync shows pending/applying/failed/retryable/auth-paused queue buckets; Local data explains local cache and credential boundaries; Platform renders sanitized capability and diagnostic rows in the global Inspector; copy diagnostics opens sanitized JSON details and keeps redaction guarantees visible.

### 8. Visual System Refinement

Keep the existing compact design direction. Do not replace it with a marketing UI, oversized cards, or one-note gradients.

Refine:

- row height, density, and alignment for task/event/note lists
- icon button sizing and tooltips
- split-pane and inspector spacing
- command palette grouping and selected-result preview
- theme contrast in dark and light mode
- calendar color usage for calendars, priorities, and conflicts
- motion for selection, completion, inspector open/close, and drag/drop feedback

Acceptance checks:

- Text fits at compact desktop widths.
- Focus rings are visible in both themes.
- Calendar colors remain legible against selected and hover states.
- Reduced-motion users do not get unnecessary animation.

## Backend And Data Support

Frontend parity requires some backend work. Add the smallest durable data support needed for each UX slice.

Data additions to plan:

- `saved_views` or settings-backed saved view definitions for filters, display options, layout, visible properties, and sort/group rules
- task scheduling fields: planned start/end or planned date/time plus duration, defer/snooze, locked scheduling flag
- task tags/properties and indexed tag counts
- task hierarchy integrity checks and parent move validation
- note links/backlinks and note properties
- calendar day/range derived indexes for fast grids
- local scheduling helper that treats calendar events as fixed unless explicitly editable

Service additions to plan:

- local view resolver that returns renderer-ready projections
- local search/filter parser and matcher
- scheduling suggestion service with deterministic rules before any AI integration
- diagnostics summaries for view/index health
- migration tests for every new persisted field/table

Do not:

- Add duplicate sources of truth for tasks, events, or notes.
- Let renderer write SQLite directly.
- Bypass existing IPC and pending-mutation contracts.
- Call Google from search, view filtering, or note link resolution.

## Suggested Implementation Slices

### Slice 1. Competitive Shell And Inspector Foundation

Start here if no backend migration should be included. Add the shared action registry, toolbar/display-control pattern, inspector shell, command palette grouping, and state polish. This improves daily usability without committing to new planner data fields.

### Slice 2. Today Timeline MVP

Add a unified Today timeline using existing due/start/event data, then introduce task duration/planned-time fields only after the renderer model is stable. Keep auto-schedule as a suggested helper, not a promise.

### Slice 3. Saved Views And Search Filters

Add the local structured search parser, filter chips, and saved views. This is the most direct synthesis of Linear, Notion, and OmniFocus while staying local-first.

### Slice 4. Task Perspectives And Bulk Actions

Add Inbox, Forecast, Review, Tags, and Projects views after tags/planned dates are available. Add bulk selection through the shared action system.

### Slice 5. Linked Notes

Add markdown preview, planner links, backlinks, and note properties. Defer graph/canvas until link indexing, note volume, and renderer performance are proven.

## Recommended Starting Point

Start with Slice 1 before deep calendar or scheduling work. The action registry, inspector, display controls, and state polish give every later feature a consistent place to live and reduce the risk of building separate interaction patterns for each screen.

Current slice status on 2026-05-23:

- Slice 1 is implemented for the shared action registry, palette availability, visible control IDs, global Inspector shell, and task/event/note/settings detail flows. Full selected-item palette execution remains deferred.
- Slice 2 is implemented for grouped Today timeline sections, planned-time/duration/locked task fields, timezone display, and local scheduling suggestions.
- Slice 3 is partially implemented through local search filters and saved search views.
- Slice 4 is partially implemented through task perspectives, saved task views, and bulk task actions.
- Slice 5 is implemented for note inspector editing, markdown preview, backlinks, link autocomplete, and broken-link repair. Graph/canvas remains deferred.
