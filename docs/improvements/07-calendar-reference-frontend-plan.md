# Calendar Reference Frontend Plan

## Scope And Evidence

This plan translates the local Apple Calendar and Notion Calendar screenshots into scoped Hot Cross Buns 2 frontend work. It does not copy competitor branding, labels, artwork, icons, or layouts. It keeps the renderer unprivileged and uses the existing React, Tailwind, CSS token, typed preload, and local-cache architecture.

Screenshot directories checked:

- `artifacts/reference-screenshots/apple-calendar/` - present and used.
- `artifacts/reference-screenshots/notion-calendar/` - present and used.
- `artifacts/reference-screenshots/ticktick/` - not used per the latest user instruction.
- `artifacts/reference-screenshots/hcb-before/` - still missing from this checkout.

Current Hot Cross Buns 2 comparison is therefore based on code inspection of the requested renderer files, not on before screenshots.

## Screenshot Inventory

| Product | Screenshot Used | Viewport | Surface | Useful UI Idea | Status |
|---|---|---:|---|---|---|
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/year-view.png` | 2930 x 1830 | Year view with left source list, mini month, centered view switcher, right date navigation | Dense overview, restrained source list, compact month cells, stable top navigation | Used |
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/month-view.png` | 2940 x 1838 | Month grid with selected current day, event/reminder bars, holiday chips | Month density, one-line event chips, all-day treatment, current-day marker | Used |
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/existing-event-in-month-view.png` | 2940 x 1850 | Month grid with selected existing event popover | Read-only event summary, source color, recurrence summary, calendar source affordance | Used |
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/new-event-in-month-view.png` | 2940 x 1844 | Month grid with new event popover | Quick-create near target cell, compact title/location/time/details form | Used |
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/new-task-in-month-view.png` | 2940 x 1840 | Month grid with new reminder/task popover | Task-calendar bridge, date/time defaults, list/priority/location affordances | Used |
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/week-view.png` | 2938 x 1838 | Week view with time grid and all-day row | Time-grid rhythm, all-day separation, visible hour labels, spacious working area | Used |
| Apple Calendar | `artifacts/reference-screenshots/apple-calendar/day-view.png` | 2940 x 1824 | Day view reference | Compact day density and hourly planning rhythm | Used |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/week-view-collapsed.png` | 2000 x 1587 | Week grid with right context panel and collapsed left source area | Dense timed blocks, multi-time-zone gutter, right-side actions, keyboard shortcut hints | Used |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/week-view-expanded-1.png` | 960 x 600 | Week grid with expanded left source list and right context panel | Source visibility, mini calendar navigation, grouped calendar accounts, calm hierarchy | Used |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/week-view-expanded-2.png` | 1534 x 954 | Week grid with expanded source list and dense event stack | Calendar toggles, colored source markers, all-day lane, overflow pressure handling | Used |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/week-view-event-creation.png` | 1666 x 1038 | Week grid with event detail side panel and create-page modal | Preserve calendar context while editing, side inspector, related-document creation pattern | Used |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/week-view-time-blocking.png` | 1962 x 930 | Week grid with availability panel and hatched available slots | Availability preview, selected time ranges, scheduling link toggle, time-blocking overlays | Used |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/menu-bar-collapsed.png` | 260 x 70 | Menu-bar next-up compact state | Ultra-compact next-up status | Used as concept only |
| Notion Calendar | `artifacts/reference-screenshots/notion-calendar/menu-bar-expanded.png` | 320 x 442 | Menu-bar agenda dropdown | Compact upcoming agenda, grouped times, settings entry | Used as concept only |
| Hot Cross Buns 2 before | Requested `artifacts/reference-screenshots/hcb-before/` | Unknown | Missing | Current-state visual comparison should be redone from real screenshots | Blocked by missing screenshots |

## Current Renderer Baseline

The renderer already has several foundations that should be preserved:

- `src/renderer/src/App.tsx` owns the shell, sidebar, global command palette, status banner, first-run onboarding, and typed preload-backed refresh flow.
- `src/renderer/src/features/core/CoreScreens.tsx` owns Today, Tasks, Calendar, Notes, Search, Settings, the global inspector bodies, calendar agenda/day/week/month views, event quick-create/editing, calendar visibility, availability export, task completion/bulk actions, scheduled task blocks, and the Today timeline.
- `src/renderer/src/features/core/coreViewModelSource.tsx` builds view models from typed preload DTOs and optimistic local mutations. It already derives today schedule slots, scheduled task blocks, calendar ranges, saved searches, and local task/event/note projections.
- `src/renderer/src/components/primitives.tsx` provides compact buttons, icon buttons, inputs, badges, panels, status banners, and list rows on design tokens.
- `src/renderer/src/styles/index.css` defines global tokens, system fonts, reduced-motion handling, and scrollbar treatment.
- `src/renderer/src/components/VirtualizedList.tsx` is available and already used for dense task, timeline, and calendar surfaces.

Relevant existing constraints from docs:

- First viewport must be the planner, not a landing page.
- Renderer remains unprivileged and talks through typed preload APIs.
- Calendar views must be virtualized or windowed for large accounts.
- Search, view models, and date/range computations must stay local-first and bounded.
- UI should be compact, keyboard-first, token-driven, and avoid decorative marketing shells.

## Source-Product Lesson Matrix

| Source | Product-Agnostic Lesson | Evidence | Current HCB 2 Fit | Plan |
|---|---|---|---|---|
| Apple Calendar | Calendar navigation should be stable and peripheral: source list left, primary range title visible, view controls stable, date navigation separate. | `year-view.png`, `month-view.png`, `week-view.png` | HCB 2 has a global section header and in-calendar tab controls, but calendar date/range navigation is thin and not visually tied to the grid. | Add a calendar-local header row with range label, previous/today/next controls, compact view tabs, and stable source-count badges inside `CalendarView`. |
| Apple Calendar | Month and week grids should optimize density before decoration. | `month-view.png`, `week-view.png`, `day-view.png` | HCB month cells have minimum height 80px and show only the first visible event. Week view is a windowed day-column strip, not a timed grid. Day view is hourly but card-like. | Tighten month cell rhythm, show up to 2 or 3 event chips plus overflow count, reduce panel chrome, and make day rows read like a time grid rather than repeated cards. |
| Apple Calendar | All-day content needs a distinct lane from timed content. | `month-view.png`, `existing-event-in-month-view.png`, `week-view.png` | HCB Today separates all-day into groups. Calendar day/week views mostly filter all-day into ordinary day cells or event lists. | Add explicit all-day lanes in Day and Week views before timed rows/columns. Keep the lane small, scroll-independent, and source-colored. |
| Apple Calendar | Event color should identify source and state without overpowering text. | `month-view.png`, `existing-event-in-month-view.png`, `new-event-in-month-view.png` | HCB uses semantic badge tones and generic surfaces; event rows do not carry calendar-source color. | First use deterministic local source color classes from visible calendar order. Later, pass Google calendar colors through typed cache DTOs if needed. |
| Apple Calendar | Quick-create/editing should stay near the selected time or cell and preserve context. | `new-event-in-month-view.png`, `new-task-in-month-view.png` | HCB uses the global Inspector for event create/edit and a Today inline quick-add. This preserves context but loses spatial connection to the calendar cell. | Keep the inspector as the durable editor, but add a compact anchored draft summary near the clicked day/hour that forwards to the inspector. |
| Notion Calendar | Source visibility should be first-class without dominating the planning grid. | `week-view-expanded-1.png`, `week-view-expanded-2.png` | HCB already has calendar visibility controls in the right support column, but not a source-organized navigation model or mini-calendar anchor. | Refine visibility controls with color swatches, grouped selected sources, and stable counts. Add a mini range navigator only if it can stay compact and local-state-only. |
| Notion Calendar | A right context panel can carry useful actions without interrupting the grid. | `week-view-collapsed.png`, `week-view-event-creation.png`, `week-view-time-blocking.png` | HCB has `SectionChrome` and a global Inspector, but the calendar support column mixes visibility, offline state, and availability export. | Keep `SectionChrome`, but split calendar support into source visibility, upcoming/availability summary, and context actions. Keep full editing in Inspector. |
| Notion Calendar | Dense week grids need source-colored blocks, clear current-time markers, and multi-time-zone clarity. | `week-view-collapsed.png`, `week-view-expanded-2.png`, `week-view-time-blocking.png` | HCB has default timezone badges, day/week events, and Today current-time marker, but not multi-zone gutters or availability overlays. | Add clearer timezone labels to day/week gutters and preserve current-time evidence. Defer multi-zone gutter support until date handling requirements are explicit. |
| Notion Calendar | Keyboard commands and compact next-up surfaces improve orientation. | `week-view-collapsed.png`, `menu-bar-collapsed.png`, `menu-bar-expanded.png` | HCB has command palette actions and a custom macOS menu-bar panel backed by the cached Today/Tomorrow native snapshot. | Extend command tests and continue verifying the menu-bar panel through the native-shell checklist. Keep native menu-bar polish separate from renderer calendar-grid work. |
| Notion Calendar | Availability/time-blocking overlays are useful but should stay bounded. | `week-view-time-blocking.png` | HCB has static availability export and Today scheduling/conflict data. | Improve availability preview in the support panel first. Defer hatched grid overlays until there is a bounded visible-range model and screenshot verification. |

## Small Frontend Edits

### Visual Polish

Target files:

- `src/renderer/src/features/core/CoreScreens.tsx`
- `src/renderer/src/components/primitives.tsx`
- `src/renderer/src/styles/index.css`

Edits:

1. Add compact calendar grid primitives inside `CoreScreens.tsx` or extract only if needed after implementation:
   - `CalendarRangeHeader`
   - `CalendarAllDayLane`
   - `CalendarEventChip`
   - `CalendarOverflowChip`
   - `CalendarSourceSwatch`
2. Rework `DayView` rows from repeated rounded cards into one continuous grid with:
   - fixed time gutter
   - thin horizontal rhythm lines
   - all-day lane above timed rows
   - event chips aligned inside the slot column
3. Rework `MonthView` cells to:
   - keep seven stable columns
   - show date label plus up to 2 or 3 compact chips
   - show an overflow count when additional visible events exist
   - avoid cell height changes when event counts change
4. Refine `WeekView` to make the all-day lane, timed blocks, and selected/current day visually distinct without copying any reference layout.
5. Add source-color CSS variables or utility classes in `index.css`:
   - use semantic fallback colors from the current theme
   - support contrast-safe text on chip backgrounds
   - keep colors scoped to calendar chips and source swatches, not global app chrome
6. Avoid nested cards. Calendar grids should be a single panel or unframed surface, not cards inside cards.

### Interaction Behavior

Target files:

- `src/renderer/src/features/core/CoreScreens.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/actions/plannerActions.ts`
- `src/renderer/src/components/CommandPalette.tsx`

Edits:

1. Add calendar-local navigation actions:
   - previous range
   - today
   - next range
   - preserve current view mode
2. Add keyboard behavior for calendar grids:
   - arrow keys move focus across month cells and day/week slots
   - `Enter` or Space opens quick-create for an empty cell or opens the focused chip
   - `Escape` closes transient quick-create state before closing the inspector
3. Keep command palette parity:
   - expose view and range navigation actions with stable IDs
   - show disabled reasons when there are no cached calendars
4. Improve quick-create flow:
   - clicking an empty month cell or day slot creates an anchored lightweight draft affordance
   - selecting edit fields opens or updates the existing global Inspector
   - focus returns to the invoking cell or chip after close
5. Improve source visibility ergonomics:
   - make source rows keyboard reachable
   - keep selected-source counts stable
   - keep visibility changes local to renderer state unless a later settings pass persists them
6. Keep task-calendar bridge visible:
   - Today keeps scheduled task blocks as first-class timeline items
   - Calendar may show scheduled task blocks only after the view model can provide a bounded per-day index

### Data And Backend Needs

No network calls, privileged renderer access, or renderer filesystem access should be added.

Target files if data support is needed:

- `src/shared/ipc/contracts.ts`
- `src/main/data/localRepositories.ts` or the current calendar-list repository owner
- `src/renderer/src/features/core/coreViewModelSource.tsx`
- `src/renderer/src/features/core/coreViewModels.ts`

Needs:

1. Calendar color is optional for the first visual pass.
   - Current local data records include calendar `backgroundColor` and `foregroundColor`.
   - `CalendarListSummary` does not expose those fields today.
   - If true source colors are required, add optional color fields to the typed IPC contract and populate them from the local cache only.
2. Calendar range navigation may need a selected date/range anchor in renderer state.
   - Keep this local to `CalendarView` for the first pass.
   - Do not persist view date until there is a documented setting or saved-view need.
3. Scheduled task blocks in Calendar views need bounded indexes before rendering.
   - Today already has schedule slots and blocks.
   - Calendar overlay should wait for a precomputed `scheduledBlocksByDay` or similar view model from `coreViewModelSource.tsx`.
4. Availability overlays should be deferred until the local calendar service can provide a bounded visible-range model.
   - Static availability export already exists.
   - A preview summary in the support panel can use the existing export path.
5. Quick-create remains existing typed calendar/task create calls.
   - Do not introduce direct Google writes from renderer.
   - Do not duplicate mutation logic outside existing preload APIs.

### Tests

Target files:

- `src/renderer/src/App.test.tsx`
- `tests/smoke/app.spec.ts`
- `src/shared/domain/calendar.test.ts`

Add or update:

1. Renderer unit tests for:
   - month cells show multiple compact chips and overflow count
   - all-day lane renders separately from timed rows
   - calendar visibility filters affect day/week/month chips
   - keyboard activation opens create/edit flows
   - command palette can switch calendar views and trigger range navigation
   - source visibility controls expose accessible names and stable counts
2. Smoke tests for:
   - Calendar view tabs
   - New event from an empty month cell or day slot
   - event inspector save path remains typed preload-backed
   - availability export remains usable after support panel changes
3. Domain tests only if range math changes:
   - week/month range anchors
   - all-day range inclusion
   - visible-range boundaries

### Performance Work

Target files:

- `src/renderer/src/features/core/CoreScreens.tsx`
- `src/renderer/src/features/core/coreViewModelSource.tsx`
- `src/renderer/src/components/VirtualizedList.tsx`
- `docs/performance/renderer-performance.md` only if budgets or measurement strategy change

Rules:

1. Day view must keep `VirtualizedList` or equivalent windowing for hour rows.
2. Week view must keep horizontal windowing and avoid mapping large event sets into every cell.
3. Month view should consume derived day indexes and avoid scanning all events per render. Current `MonthView` already reads `source.calendarMonthWeeks`; preserve that direction.
4. Use `useMemo` around visible event/day projections where it prevents repeated filtering across rendered cells.
5. Do not add DOM measurement loops for chip layout. Use fixed chip counts plus overflow labels.
6. Mount one transient quick-create affordance, not one hidden popover per calendar cell.
7. Preserve `reportRendererTimingSince("calendar.navigate", ...)` and add metadata only if useful and cheap, such as `view`, `visibleEventCount`, and `visibleCalendarCount`.

## Implementation Order

1. Screenshot preflight:
   - Keep Apple and Notion filenames in this document as the evidence set.
   - Continue to mark `hcb-before` blocked until those screenshots exist.
   - Do not include TickTick unless the user explicitly re-adds it as a reference source.
2. Calendar source color and chip primitive:
   - Add deterministic source-color helper in `CoreScreens.tsx`.
   - Add compact `CalendarEventChip` with accessible label and stable height.
   - Add `CalendarSourceSwatch` for source visibility rows.
   - Use semantic fallback CSS variables in `index.css`.
3. Month density pass:
   - Update `MonthView` to render multiple chips plus overflow count.
   - Keep fixed cell dimensions and keyboard activation.
4. Day all-day/time-grid pass:
   - Add all-day lane above virtualized timed rows.
   - Replace per-hour card styling with continuous grid rhythm.
   - Keep drag/drop and resize actions through existing typed update requests.
5. Week all-day/source visibility pass:
   - Add all-day lane per visible day.
   - Keep horizontal windowing.
   - Retain visible-calendar filtering.
6. Calendar support panel pass:
   - Split visibility, next-up/upcoming, and availability export into clearer compact groups.
   - Keep full event editing in the global Inspector.
7. Calendar range navigation:
   - Add local range anchor state and previous/today/next controls.
   - Wire command palette actions after visible controls work.
8. Quick-create polish:
   - Add anchored draft affordance for empty cells/slots.
   - Preserve global Inspector as the full editor.
   - Verify focus return.
9. Tests and verification:
   - Add focused renderer tests.
   - Update smoke coverage.
   - Run unit tests, then smoke/perf only if the implementation affects renderer timing or Electron flows.

## Accessibility Risks

- Calendar grids can become keyboard traps if cells, chips, resize handles, and inspector controls all compete for focus. Use roving focus or a simple predictable tab order, not both at once in the same grid.
- Color-coded event chips need text labels and accessible names because calendar source color alone is not enough.
- Source visibility rows need visible focus states and checkbox labels that do not rely on color swatches.
- Overflow chips must be keyboard reachable if they open a list, or static text if they only report hidden count.
- Drag/drop must keep keyboard alternatives for moving events and scheduled task blocks.
- Anchored quick-create must return focus to the invoking cell or chip after save/cancel.
- All-day lanes need clear accessible labels separate from timed grids.

## Performance Risks

- Rendering every event in every month cell can regress the known calendar navigation cost, already noted around 38-41ms in renderer performance docs.
- Day/week overlap calculations in component render can become expensive for large accounts. Keep range/event grouping in view-model construction or memoized selectors.
- Variable-height month cells can cause layout shift and expensive repaint. Use fixed cell heights and overflow counts.
- Adding popovers per cell would mount too many hidden nodes. Mount a single transient quick-create affordance or use the existing Inspector.
- Calendar source color derivation must be O(calendar count), not repeated for every chip render.
- Availability/time-blocking overlays can explode DOM node counts if every candidate slot is rendered. Keep the first pass in the support panel.

## Screenshot Verification Plan

When implementation work starts, capture fresh screenshots before and after with Playwright or the in-app browser:

- HCB Calendar agenda view.
- HCB Calendar day view with all-day and timed events.
- HCB Calendar week view with at least one all-day event and one timed event.
- HCB Calendar month view with multiple event chips and overflow.
- HCB Calendar support panel with source visibility and availability export.
- HCB Today timeline with scheduled task blocks and unscheduled tasks.
- HCB Calendar quick-create from an empty month cell or day slot.
- HCB event inspector after opening a chip.

Store them under `artifacts/reference-screenshots/hcb-after/` or a similarly documented output path. If `hcb-before` screenshots are restored, record the exact source filenames used in this document.

## Acceptance Checklist

- Screenshot inventory names every screenshot actually used.
- Apple Calendar and Notion Calendar are backed by local filenames.
- TickTick is excluded by latest user instruction.
- HCB-before remains blocked because usable screenshots are missing.
- Visual polish, interaction behavior, data/backend needs, tests, and performance work are separated.
- Exact target files are listed for each work type.
- Planned work preserves typed preload IPC, local cache state, and renderer privilege boundaries.
- No landing page, marketing shell, copied competitor assets, or renderer network/filesystem access is introduced.
