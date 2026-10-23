# Calendar interactions and daily-driver audit

Review updated: **23 October 2026**. Mode: **full**. This supersedes the 22 October findings; the earlier evidence remains in Git history.

The four priority defects are resolved in the local production build: linked-task completion, native item targeting, calendar write permissions, and loading/delivery feedback. Overflow focus, grid keyboard traversal, Month/Notes readability and navigation-limit feedback are also corrected. The macOS menu bar panel now uses the application's appearance settings and clearer controls. This remediation is accepted with the measured performance limits documented below; consistently meeting the 400ms populated-view target and live provider validation remain open verification work.

## Scope and boundaries

Reviewed the Electron renderer, calendar/task/note inspectors, shell navigation, registered IPC, scheduling, recurrence, undo, Google outbox projections, and the macOS menu bar panel. The recovered experimental frontend was `experiment/reference-cal` at `54bc101`, removed by `c932d67`; the older `prototypes/reference-cal` was also inspected in history. Current docs/reference content is historical context rather than a runnable replacement frontend.

The app is a keyboard-oriented desktop planner over Google Tasks/Calendar and local notes. Navigation consists of renderer sections and inspector commands, native item/deep links, and registered Core/Diagnostics IPC. The older Planner/Settings IPC files are not registered by `src/main/index.ts`. Route families were traced through preload, dispatch and destination consumers; the audit does not treat an allowlisted method as proof of an implemented capability.

Framework: React 19, Electron 33, Radix, Motion, Tailwind and existing CSS variables. The native panel retains its static HTML/CSS renderer with JavaScript disabled. It imports the shared semantic color catalog, uses the existing native snapshot, and dispatches the existing route/action URLs. No second data store, recurrence engine, sync service or frontend framework was introduced.

Runtime evidence comes from disposable local accounts on macOS and the production Electron build. The panel smoke test renders the production HTML in an isolated Electron BrowserWindow with the production security settings; controller tests separately cover Escape, positioning and route dispatch. Physical tray interaction, signed installation, live Google reader-calendar/rejection flows, Windows/Linux and a screen-reader session remain **not verified**.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Populated Month at 1600×1000, 1180×760 and 850×700; Notes; menu bar light/dark, long titles and 24px text | Month titles take priority; six weeks fit laptop heights; note timestamps use a secondary line. Panel titles wrap to two lines with full labels/tooltips. |
| Surfaces | Inspectors, overflow, nested menus; menu bar calendar/agenda/compact/empty/account states and short window | Overflow contains focus and restores its trigger. Panel footer stays visible; links have visible focus and at least 40px footer targets. |
| Animations | Existing view/inspector tests; menu playback at 10% through CDP; panel hover at 10% and reduced motion | Existing view motion retained. Panel only transitions color/opacity for 120ms; no entrance sequence; Disable animations and reduced motion are honored. |
| Icons | Existing renderer Lucide family; static panel line SVGs, currentColor, task/event/search distinctions | Consistent line style and state colors. Icons supplement labels; navigation actions have explicit accessible names. |
| Performance | Bounded Month/viewport caches; latest-range loader; populated click-to-settled timings; opt-in CPU and layout profiles | Existing bounds retained. Month now uses the size supplied by ResizeObserver instead of forcing an initial layout; unused shared Day/Week/Month projections were removed. Populated transitions still sometimes exceed the 400ms comfort target; see limitations. |

## Resolved findings

Paths prefixed with `calendar/` below are under `src/renderer/src/features/core/screens/calendar/`; adjacent unqualified calendar filenames use the same directory.

### Trust and feedback

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `src/main/services/coreStore.ts:1836`; `src/renderer/src/features/core/viewModelSource/sourceBuilder.ts`; `calendar/CalendarEventChips.tsx` | Completing a scheduled block left its task active. | Linked blocks project task completion; Complete/Reopen task calls the existing task update path. Ordinary event completion remains supported. Persistence, multiple blocks and undo are covered. | Completion must mean the same thing in the calendar and task list. |
| HIGH | `src/renderer/src/features/shell/AppShell.tsx:297`; `src/renderer/src/features/shell/PaneWorkspace.tsx` | Native routes discarded item IDs; Today could retain an old date. | Preserve IDs, wait for the destination section to mount, open the item and reveal its date; Today resets using the displayed timezone. Missing targets report an error. | A native link must reach its target. |
| HIGH | `src/main/services/coreStore.ts:904`; `src/shared/calendarPermissions.ts`; calendar creation, scheduling and inspector controls | Google's accessRole was discarded; controls offered unsupported writes. | Persist source permissions, derive write capability, label/disable editing and gestures, and reject source/destination violations before enqueueing writes. Unknown remote roles require refresh. Writable duplication remains available. | Prevent misleading edit controls and undeliverable writes. Live Google verification remains outstanding. |
| HIGH | `calendar/CalendarSyncStatus.tsx:18`; `useCalendarRangeLoader.ts`; `coreStore.ts` | Loading ranges and locally queued/failed Google changes had weak feedback. | Show loading/retry, cached/offline and queued/failed states; use durable outbox state for affected events and linked tasks; link recovery to existing diagnostics. Local-only changes are labeled separately. Full refreshes explicitly invalidate the active viewport so saved items remain visible. | Local persistence and provider delivery have distinct outcomes. |

### Interaction, typography and keyboard access

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `calendar/MonthView.tsx:48`; `CalendarTimelineView.tsx`; `useCalendarPointerGesture.ts` | Limited persisted movement and start/end resizing. | Month/timeline movement, both all-day edges, timed start/end resizing, preserved grab offset/duration, edge scrolling, preview and Escape/blur cancellation. Save once through existing services on release. | Predictable direct manipulation with visible feedback and keyboard alternatives. |
| HIGH | `calendar/useCalendarEventInspector.tsx`; `CalendarRecurrenceDialog.tsx`; `src/main/services/calendarTimeChange.ts`; `coreStore.ts` | A series gesture could rebase its master to a later instance; scheduling metadata could diverge; unsupported delete scope was exposed. | Shift relative to the original master, preserve explicit weekday/date semantics, use scheduled-block services, review scope, and reject unsupported exception/selector transformations before writing. Only supported delete scopes are shown. | Preserve recurrence and scheduling meaning. Remaining capability limits are listed below. |
| MEDIUM | `calendar/CalendarEventMenu.tsx`; `CalendarAgendaView.tsx`; `CalendarEventChips.tsx` | Item actions were distant from their targets. | Right-click/Shift+F10 offers edit, full-text copy, duplicate, supported deletion and Change date and time through the existing inspector. Tasks open their editor. | Reuse established actions with full details and clear scope. |
| MEDIUM | `calendar/CalendarOverflowPopover.tsx:71`; `CalendarEventMenu.tsx` | Modal overflow leaked Tab focus; nested portaled menus conflicted with dialog accessibility. | Radix modal initial focus, Tab containment and trigger restoration; context menu portal stays in the dialog; first Escape closes its menu, next Escape closes overflow. | Modal focus containment and predictable dismissal. |
| MEDIUM | `calendar/useCalendarGridFocus.ts:4`; `MonthView.tsx`; `CalendarTimelineView.tsx`; `CalendarHeader.tsx` | Week grids added up to 168 cell Tab stops. | One grid cell Tab stop; arrow/Home/End navigation, documented shortcuts and inspector-based precision editing. Event controls remain reachable. | Efficient keyboard travel without distorting adjacent event hit geometry. |
| MEDIUM | `calendar/MonthView.tsx:96`; `calendarMonthLayout.ts`; `styles/index.css`; `screens/NotesBoard.tsx:250` | Six Month rows extended beyond laptop windows; times and note timestamps crowded titles. | One to six Month lanes based on available height, bounded six-week layout, title-first chips with time suppressed at narrow widths, and note timestamps on a secondary line. | Prioritize identification while retaining overflow and full accessible details. |
| MEDIUM | `calendar/calendarNavigationLimits.ts:4`; `CalendarView.tsx`; `CalendarHeader.tsx`; `useCalendarWheelNavigation.ts`; `useCalendarRangeLoader.ts` | Fixed jumps, queued intermediate ranges and unexplained navigation stops. | Bounded rolling day/week windows; one active load plus latest replacement; discoverable wheel/grid help; disabled arrows and quiet limit explanations with Settings access. Returning toward valid dates remains possible. | Spatial continuity, bounded work and understandable retention/future limits. |

### Menu bar consistency and honest controls

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `src/main/native/electronMac/menuBarPanelStyles.ts`; `menuBarPanelHtml.ts`; `src/main/native/menuBarSnapshot.ts`; `types.ts` | Independent blue/system palette, short truncated rows, cramped account details and small scrolling footer actions. | Shared light/dark/custom palette and per-surface font settings; two-line full titles, secondary time labels, consistent line icons, compact account block, structural dividers and fixed 40px footer controls. Compact heading stays short at large text sizes. | Match the application hierarchy, typography and surfaces while retaining a lightweight native panel. |
| HIGH | `src/main/native/electronMac/menuBarPanelHtml.ts:29`; `menuBarPanelController.ts`; `src/main/native/menuBarSnapshot.ts:81` | Previous/Next/Today all opened generic Calendar; empty anchors were focusable; connected account was labeled Synced. | One explicit Open today in Calendar link; noninteractive empty rows; visible keyboard focus and Escape dismissal; Google connected/Check Google connection/On this device labels. Pinned filters and item IDs use existing routes. | Controls should describe their actual effect, and connection does not prove delivery. |

## Remaining findings and boundaries

| Severity | Location | Before | After / next step | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `calendar/MonthView.tsx:95`; `src/renderer/src/features/core/viewModelSource/sourceBuilder.ts`; `tests/smoke/populated-planner.spec.ts` | A forced Month size read and an unused duplicate calendar day index added work. Initial timing fixtures also replaced native performance APIs and animation scheduling. | Use ResizeObserver's supplied size and retain only consumed projections. Freeze only the fixture date; preserve native timers, RAF and performance marks. Record loading, grid mounting and animation endpoints, with trace layout totals clipped to the measured interval. | Native unprofiled samples still sometimes exceed the 400ms comfort target. The unchanged 1500ms regression ceiling is not a 400ms guarantee, and removing measured work does not establish an equivalent end-to-end saving. An idle-target benchmark is not claimed. |
| MEDIUM | `calendar/CalendarRecurrenceDialog.tsx`; `src/main/services/coreStore.ts` | Future-series deletion and unrestricted exception migration were incomplete. | Safe supported scopes remain available. Deleting this and future occurrences and whole-series time gestures with stored exceptions/complex selectors remain unavailable. A future feature needs coordinated exception/undo/provider migration tests before exposure. | This is a capability gap behind explicit guards, rather than an exposed destructive option. It was outside the four priority fixes and the added visual menu bar scope. |

## Experimental frontend comparison

The live renderer already carries the reference palette, sidebar/inspector structure, inline fields, view menu, calendar chips, context actions, type selection and restrained motion. The experimental frontend's demo storage, sample accounts and simplified recurrence are inappropriate replacements for the existing database/outbox/undo system.

Adaptive Month density was a useful remaining presentation idea and is now implemented through the live layout. Optional follow-ups include Month date-number drilldown to the containing week, a lightweight event preview popover, and further continuous-scroll alignment. These can call existing date navigation and item-detail commands. They were reviewed as opportunities and were not added as new feature scope during this remediation.

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Calendar services | Import prototype persistence, accounts or recurrence | Duplicates live ownership and loses sync/undo semantics. |
| Calendar viewport | Retain all visited periods or prefetch months | Work would grow with navigation history and defeat cache bounds. |
| Timeline targets | Expand every short event/handle into a 40px rectangle | Adjacent times overlap and move targets disappear; keyboard precision editing preserves geometry. |
| Native panel | Mount a second React planner or enable scripts for month navigation | Existing snapshot/routes provide the required agenda and actions with less startup work and a smaller privileged surface. |
| Appearance and performance | Add layout/paint containment to calendar frames or shorten existing transitions | The containment trial produced inconsistent Week results: 392ms light / 572ms dark against 408ms / 407ms baselines under different host loads. It was removed. The evidence does not support changing established motion. |

## Verification

| Check | Observed result |
| --- | --- |
| `corepack pnpm build` | Passed both TypeScript checks and the production bundles. |
| `corepack pnpm typecheck` after final fixture changes | Passed. |
| `corepack pnpm exec electron-vite build` after removing the containment experiment | Passed; restored the original renderer bundle hash. |
| `corepack pnpm test:unit --maxWorkers=1` | **242 passed**; the 134 database tests are skipped in this Node stage and run separately below. |
| `corepack pnpm test:db` | **134 passed** under Electron. |
| Seven previously failed Electron scenarios | **7 passed** in one focused rerun with normal assertions and deadlines. |
| Full Electron suite, `caffeinate -i corepack pnpm test:ui --reporter=line --output=output/playwright-signoff` | **68 passed in 8.1 minutes**, including the stricter abnormal-exit checks. Log: `/tmp/hcb-signoff-ui.log`. |

The earlier full UI run completed **61 passed / 7 failed** and included hour-long stalls and abnormal process exits (`/tmp/hcb-final-native-stages.log`). Those historical failures are retained. Their underlying runtime cause was not established. The fixture now gives cleanup a separate deadline, records lifecycle/stderr and renderer crashes, reads native events synchronously, and rejects abnormal exit codes/signals. Forced termination remains a failure. Three deliberately failing mocked checks verified cancellation cleanup, stalled-close cleanup and rejection of a SIGSEGV exit while preserving the original body error.

Requirement coverage includes linked-task completion/reopen across multiple blocks and reload; exact native event/task/note targeting and Today; read-only controls and persistence; queued/failed feedback and existing recovery; overflow focus/nested Escape; grid navigation; responsive Month/Notes; navigation boundaries; and existing gesture, recurrence, undo and failure-recovery behavior. A provider/loader integration test also reproduced and fixed disappearing events after a bootstrap refresh.

Menu bar coverage includes 3 HTML/snapshot tests, 6 native planning tests, 1 controller test and the real Electron panel scenario. It exercises full titles and item links, light/dark, agenda/calendar/compact, empty/account states, focus, hover at 10% speed, 24px text at 360×480, a visible footer and reduced motion. The panel test waits for the actual native navigation event before checking its destination. All application tests use disposable local data.

Screenshots inspected under `output/ui-review/`: `populated-month-{850,1180}-{light,dark}.png`, `populated-note-light.png`, and `menu-bar-{agenda-light,calendar-dark-13,compact-light-24,compact-dark-13,account-dark-13}.png`. These are review evidence, not pixel baselines.

### Measured performance limits

The final native unprofiled run used 493 events, 24 birthdays, 600 tasks, 240 notes and six task lists at 1600×1000. The fixture freezes only Date and asserts that native performance APIs, RAF and timers remain intact. The 400ms value is a comfort target; 1500ms is the unchanged regression ceiling.

| View | Light | Dark |
| --- | --- | --- |
| Month | 359ms | 335ms |
| Week | 427ms | 391ms |
| Day | 303ms | 305ms |
| 3 days | 309ms | 310ms |

These samples are preserved in `output/ui-review/populated-performance-{light,dark}.json`. Seven of eight met 400ms; light Week exceeded it by 27ms. All eight met the 1500ms ceiling. Host one-minute load averages were approximately 38 and 31 on eight logical CPUs. They establish the observed behavior under contention and do not establish idle-machine latency or a causal before/after speedup. Separate earlier samples in `containment-baseline-{light,dark}.json` were used for the rejected containment experiment.

A native light-mode CPU/trace run measured Month **687ms**, Week **580ms**, Day **400ms** and 3 days **1954ms**. The last sample failed the 1500ms ceiling; it is not a passing performance result. Its clipped trace showed 37ms layout, 50ms style, range loading finished by 184ms, and a roughly 1.7-second gap between animation frames with no scripts or blocking work. The cause of that scheduling gap remains unproven. Earlier measurements made with Playwright's replacement clock are historical diagnostics and are not used as native frame-timing evidence.

CPU profiles, raw traces, DOM timing samples and interval summaries are saved before assertions under `output/ui-review/` and attached to the run artifacts. Loading intervals include debounce, IPC/cache work and render; they do not isolate pure database/provider time. Trace layout/style totals are clipped to the click/settle marks; broader CPU/Performance windows include automation and profiling overhead. These intervals overlap and must not be added as exclusive phases. Short frame samples do not support an FPS claim.

The requested remediation is complete with documented performance limits. **Verdict: Needs changes for unrestricted daily-driver sign-off.** The four HIGH priority defects and the menu bar's misleading controls are resolved in local automated checks. Remaining medium findings concern consistent populated-view latency and broader recurrence capabilities. Not verified: live Google permission/rejection flows, a physical OS tray session, signed installation, Windows/Linux, screen-reader interaction, sustained 5k/10k performance and an idle-target 400ms performance run.
