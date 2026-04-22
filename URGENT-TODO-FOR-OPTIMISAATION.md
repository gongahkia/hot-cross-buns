# Urgent Work to Optimize Hot Cross Buns

Date: 2026-04-22

Scope: repository-wide static audit of the current macOS SwiftUI application with emphasis on perceived latency, jank, avoidable work, broad invalidation, sync cost, and responsiveness. This report is code-backed, not trace-backed. It should be followed by Instruments runs before large architectural work is scheduled.

## Executive summary

Hot Cross Buns is a macOS SwiftUI personal planner that makes Google Tasks and Google Calendar feel like a local, keyboard-friendly desktop app. The current architecture already has several good optimization foundations: local cache loading, event sidecar persistence, day-bucketed calendar snapshots, debounced cache saves, and calendar grid caches.

The largest remaining performance risk is that too much of the app observes one very large `@Observable` `AppModel`. Task edits, event syncs, auth changes, settings changes, notification scheduling, Spotlight indexing, cache saves, and derived snapshot rebuilds all live behind the same object. That makes the app easier to reason about centrally, but it also creates broad UI invalidation and makes small user actions able to trigger large background work.

The next most urgent issue is that several "make it fast" caches are keyed only by collection counts. That can make the app fast but stale: event title, time, color, or task detail changes with the same total count may not invalidate month/week grid caches or command palette search snapshots. A snappy app cannot trade correctness for speed.

The practical path is:

1. Add resource revision counters and fix cache keys.
2. Stop full notification and Spotlight rebuilds from sitting on common mutation paths.
3. Replace remaining full-array scans in agenda/menu/search/kanban paths with existing indexes or new dictionaries.
4. Lazily render large boards and cache derived grouping.
5. Split `AppModel` into narrower stores once the hot paths are measured.

## What the project is trying to achieve

The repository is centered on a native macOS app in `apps/apple/HotCrossBuns`. The older server/Tauri approach has been removed; the Apple app is now the canonical product.

The intended product shape is:

- Google Tasks and Google Calendar are the source of truth.
- Local cache gives fast launch, offline viewing, local pending mutations, and local search.
- The UI combines list, calendar, kanban, command palette, notes, reminders, Spotlight, and menu bar workflows.
- The app should feel local-first even though data ultimately syncs to Google.

That means perceived performance matters more than raw sync completion time. A user should be able to launch, search, toggle a task, drag-create an event, type a note, and scroll the calendar without waiting for Google, Spotlight, notifications, cache encoding, or unrelated SwiftUI views.

## Repository structure that matters for performance

- `apps/apple/HotCrossBuns/App`: app entry, shell, root model, theme, drag/drop, diagnostics.
- `apps/apple/HotCrossBuns/Features`: user-facing SwiftUI screens such as calendar, tasks, kanban, store, command palette, notes, settings.
- `apps/apple/HotCrossBuns/Models`: local mirror models and domain types.
- `apps/apple/HotCrossBuns/Services`: Google API clients, sync, cache, audit log, notifications, Spotlight, network monitoring, geocoding.
- `docs`: architecture and refactor notes.
- `Makefile` and `apps/apple/project.yml`: XcodeGen and build/test entry points.

## Existing performance work already in place

These should be preserved; several recommendations below build on them.

- `AppModel.scheduleCacheSave()` debounces cache writes by 500 ms and flushes on background.
- `AppModel.scheduleRebuildSnapshots()` coalesces snapshot rebuilds to the next run loop.
- `AppModel.rebuildSnapshots()` already creates `eventsByDay`, `tasksByDueDate`, `eventsByCalendar`, task-list stats, and related indexes.
- `LocalCacheStore` splits calendar events into `cache-events.json` and skips event sidecar writes when the event hash is unchanged.
- `MonthGridView` and `WeekGridView` already have grid caches.
- `CommandPaletteView` debounces search input and precomputes lowercase entity labels.
- `SyncScheduler` fetches task lists and calendars concurrently.

The problem is not that the code ignores performance. The problem is that the optimization layer is incomplete and, in a few places, under-keyed or attached to paths that still do too much work.

## Highest impact findings

### P0: The monolithic `AppModel` causes broad observation fan-out

Evidence:

- `apps/apple/HotCrossBuns/App/AppModel.swift:5` defines one `@MainActor @Observable final class AppModel`.
- The model owns auth state, account state, selected lists/calendars, task lists, tasks, calendars, events, settings, sync status, pending mutations, derived snapshots, diagnostics, notifications, Spotlight, and cache save state.
- `@Environment(AppModel.self)` appears in 72 Swift files.
- Common user operations call into `AppModel`, update arrays or settings, schedule cache saves, rebuild snapshots, synchronize notifications, and sometimes trigger sync-related state changes.

Why this hurts UX:

- SwiftUI views that only need settings, selection, auth, sync, tasks, or events still observe the same broad model.
- Mutating a task can invalidate calendar, menu bar, command palette, inspector, settings, and root scene views even when they do not need the changed field.
- Near-realtime sync can republish large arrays and cause visible screens to recompute.

Tangible fix:

- Add narrower stores before a full rewrite:
  - `TaskStore`: task lists, tasks, task indexes, task mutations.
  - `EventStore`: calendars, events, event indexes, event mutations.
  - `SettingsStore`: user settings and selected IDs.
  - `SyncStateStore`: sync phase, errors, last sync, pending counts.
  - `IntegrationStore`: notifications, Spotlight, menu bar state.
- Keep `AppModel` as a coordinator during transition, but inject narrow stores into feature subtrees.
- Add explicit revision counters for `tasks`, `events`, `taskLists`, `calendars`, and `settings`. Cache keys should depend on revisions, not raw counts.

Validation:

- Use Instruments SwiftUI template to count body invalidations while:
  - toggling one task,
  - creating one event,
  - completing a sync while month view is visible,
  - opening command palette while sync state changes.
- Target: at least 50 percent fewer body evaluations on common single-item mutations after store split.

### P0: Notification and Spotlight rebuilds are too heavy for common mutation paths

Evidence:

- `AppModel.synchronizeLocalNotifications()` at `apps/apple/HotCrossBuns/App/AppModel.swift:3317` calls both the local notification scheduler and the Spotlight indexer.
- That method is called after many task/event/list/calendar mutations and after sync/apply paths.
- `LocalNotificationScheduler.synchronize(...)` removes scheduled notifications, scans all tasks/events, sorts due items, and re-adds requests.
- `SpotlightIndexer.update(tasks:events:)` maps all tasks and events, deletes entire Spotlight domains, and indexes the full replacement set.

Why this hurts UX:

- Completing a task, editing text, changing a due date, or applying sync state can cascade into full notification and Spotlight work.
- Even if some work is asynchronous, it competes with the app on CPU, memory, IO, and system services.
- The user-visible action should complete immediately; background integrations should catch up after.

Tangible fix:

- Split one method into two independent services:
  - `NotificationSyncService`
  - `SpotlightIndexService`
- Track dirty task IDs and dirty event IDs.
- Debounce both services separately, for example 1-3 seconds after the last local mutation and longer after sync bursts.
- Make Spotlight incremental:
  - index changed IDs,
  - delete removed IDs,
  - avoid deleting entire task/event domains except for explicit rebuild.
- Make notifications incremental where possible:
  - remove and recreate only affected notification IDs,
  - keep a small persisted map of scheduled notification IDs to source revision.
- Never await full notification or Spotlight rebuilds on the direct UI command path.

Validation:

- Measure time from task checkbox click to visible completion state.
- Measure CPU and main-thread time during a 100-item sync apply.
- Target: local checkbox feedback under 100 ms; background integrations should not cause visible frame drops.

### P0: Several caches are keyed by collection counts and can go stale

Evidence:

- `MonthGridView.currentGridCacheKey` uses selected IDs, search query, month key, and `model.events.count`.
- `WeekGridView.currentWeekCacheKey` uses selected IDs, search query, week start, and `model.events.count`.
- `CommandPaletteView.snapshotKey` uses counts for tasks, events, lists, and calendars.

Why this hurts UX:

- If an event is renamed, recolored, rescheduled, or edited without changing the total event count, the cached month/week layout may not update.
- If a task title, note, tag, or event title changes without changing counts, the command palette may search stale labels.
- Users experience this as "the app is laggy" or "the app did not update" even though the real bug is cache invalidation.

Tangible fix:

- Add revision counters to the resource layer:
  - `eventRevision`
  - `taskRevision`
  - `calendarRevision`
  - `taskListRevision`
  - `settingsRevision` or selection-specific revisions
- Increment revisions on apply, local create/update/delete, sync merge, and pending mutation resolution.
- Replace `events.count` and count-only keys with revisions.
- For correctness-critical caches, include a cheap hash of visible IDs and updated timestamps if revision counters are not yet available.

Validation:

- Add tests or manual checks:
  - rename event while month view is open,
  - move event to another day with same total count,
  - change calendar color,
  - rename task and search old/new query in command palette.

### P0: Kanban renders and recomputes too much for large task sets

Evidence:

- `KanbanView.columns` recomputes grouping and sorting from `model.tasks`, `model.taskLists`, and settings every body evaluation.
- `KanbanColumnView` uses `ScrollView` plus `VStack` plus `ForEach(column.tasks)` for cards.
- Large columns instantiate all cards, not just visible cards.

Why this hurts UX:

- Kanban is one of the views most likely to show many tasks at once.
- Horizontal scrolling, drag/drop, and status updates can trigger full regrouping and full card tree construction.
- A large board will feel heavy even if individual cards are simple.

Tangible fix:

- Use `LazyHStack` for columns and `LazyVStack` inside each column.
- Cache grouped columns in a derived store keyed by:
  - `taskRevision`,
  - `taskListRevision`,
  - kanban grouping setting,
  - selected filters/search query.
- Keep card IDs stable and avoid rebuilding view models for unchanged cards.
- For very large boards, consider a `List`-based column implementation or virtualized card stacks.

Validation:

- Create local fixtures with 1,000 and 5,000 tasks.
- Scroll vertically inside one large column and horizontally across columns.
- Target: no obvious hitching at 1,000 tasks; acceptable degraded but usable behavior at 5,000 tasks.

## High priority findings

### P1: Some calendar and agenda paths still scan full arrays

Evidence:

- `CalendarHomeView.agendaEventsByDay` loops over all `model.events` for a 14-day agenda.
- `CalendarHomeView.agendaTasksByDay` loops over all `model.tasks`.
- `MenuBarExtraScene.agendaSections` scans events and tasks for each day in the menu bar agenda.
- `YearGridView.eventIndicators` iterates day buckets for the selected year each body evaluation.

Why this hurts UX:

- These views run often: calendar home, menu bar, and year overview are high-visibility surfaces.
- The app already pays to build `eventsByDay` and `tasksByDueDate`; scanning the full corpus again wastes the previous optimization.

Tangible fix:

- Replace agenda event scans with lookups into `model.eventsByDay`.
- Replace agenda task scans with lookups into `model.tasksByDueDate`.
- Add `calendarsByID` and `taskListsByID` dictionaries for quick decoration and filtering.
- Cache year indicators by `year + eventRevision + selectedCalendarRevision`.

Validation:

- Open calendar home with 10,000 events and 2,000 tasks.
- Toggle selected calendars while agenda is visible.
- Open menu bar agenda during sync.
- Target: agenda construction under 16 ms for cached data, and no repeated full-corpus scans in Time Profiler.

### P1: Command palette search has avoidable regex and lookup costs

Evidence:

- `CommandPaletteView` limits fuzzy matching to a prefiltered set, which is good.
- Regex queries call `AdvancedSearchMatcher.regexMatches` per entity.
- `AdvancedSearchMatcher.regexMatches` compiles `NSRegularExpression` inside each call.
- Structured task/event matching uses linear lookup into task lists/calendars for each entity.

Why this hurts UX:

- The command palette is a responsiveness feature. It must feel instant.
- Regex search over thousands of entities can compile the same regex thousands of times.
- Linear list/calendar lookups compound cost during structured queries.

Tangible fix:

- Parse and compile regex once per query.
- Pass the compiled regex into entity matching.
- Prebuild dictionaries:
  - `taskListsByID`
  - `taskListsByTitleLowercased`
  - `calendarsByID`
  - `calendarsByTitleLowercased`
- Fix the snapshot cache key with resource revisions, not counts.

Validation:

- Test command palette on 17,000 entities with:
  - normal query,
  - structured query,
  - regex query.
- Target: first useful results under 150 ms for normal search and under 300 ms for regex search.

### P1: Sync request volume and concurrency need guardrails

Evidence:

- `SyncScheduler.listTasks` starts one task-group child per selected task list.
- `SyncScheduler.listEvents` starts one task-group child per selected calendar.
- `GoogleCalendarClient.listEvents` uses `maxResults=250`.
- `GoogleAPITransport.makeRequest` calls an `@MainActor` token provider for each request.

Why this hurts UX:

- Initial sync or large calendar sync can create many HTTP requests.
- Unbounded fan-out can compete for CPU/network and trigger rate limiting.
- Repeated token access from parallel requests can bounce through the main actor.
- Google Calendar supports larger pages than 250 for typical event listing; using 250 increases round trips for large calendars.

Tangible fix:

- Raise Calendar event page size to the API-supported maximum appropriate for this endpoint, commonly 2500, after confirming behavior with tests.
- Add concurrency caps:
  - 4-6 calendars at a time,
  - 4-6 task lists at a time.
- Cache the bearer token for one sync pass instead of asking the token provider on every request.
- Record per-sync metrics:
  - request count,
  - page count,
  - bytes decoded,
  - total sync time,
  - merge/apply time.

Validation:

- Compare request counts and sync duration before/after with a large calendar.
- Confirm no increase in Google API errors.
- Target: materially fewer calendar list requests and smoother UI during sync.

### P1: Cache persistence is improved but still expensive for large data

Evidence:

- `LocalCacheStore` decodes whole JSON cache files on launch.
- It writes atomically to main cache and event sidecar.
- The JSON encoder uses `.prettyPrinted` and `.sortedKeys`.
- Event sidecar hash-skip is already implemented, which is good.

Why this hurts UX:

- Pretty-printed sorted JSON is useful for debugging, but it adds CPU and disk overhead.
- Whole-file JSON decode is acceptable for small/medium data but becomes a launch-time bottleneck for very large event caches.
- If the app target is "feels native and instant", launch should show useful cached UI before expensive derived work finishes.

Tangible fix:

- Use compact JSON in release builds; keep pretty/sorted output only in debug if needed.
- Log cache file sizes and decode/encode durations.
- If cached events regularly exceed 50,000 or launch exceeds target budgets, move hot data to SQLite:
  - events table indexed by start day, calendar ID, updated timestamp,
  - tasks table indexed by due day, list ID, status,
  - pending mutations table append-only.
- Keep JSON export/import as a diagnostic tool, not the primary hot cache.

Validation:

- Measure cold launch with 10,000 and 50,000 events.
- Target: useful cached UI under 1.5 seconds for 10,000 events and under 3 seconds for 50,000 events.

### P1: Markdown editing can lag on long notes

Evidence:

- `MarkdownHighlighter.apply` runs a full-document highlighting pass after text changes.
- Regex patterns are rebuilt inside helper paths.
- `MarkdownBlock.body` parses markdown and creates `AnyView` rows during body evaluation.

Why this hurts UX:

- Typing is the most latency-sensitive interaction in the app.
- Full-document syntax highlighting on every keystroke will eventually show input lag on long notes.
- `AnyView` and body-time parsing add allocation and diffing cost.

Tangible fix:

- Make highlighter regexes static cached values.
- Highlight only the changed paragraph or visible range where possible.
- Debounce full re-highlight to idle time.
- Cache parsed markdown blocks by note ID and note revision.
- Avoid rendering markdown previews in large repeated rows.

Validation:

- Type continuously in notes with 1,000, 5,000, and 10,000 characters.
- Target: keystrokes remain visually immediate; full highlight can settle shortly after typing pauses.

## Medium priority findings

### P2: Mutation audit logging rewrites too much

Evidence:

- `MutationAuditLog.record(...)` appends to an in-memory buffer and persists the full buffer on every record.
- Retention allows up to 50,000 entries.
- The existing urgent TODO notes that audit logging also needs security attention because it is plaintext.

Why this hurts UX:

- Frequent edits can turn logging into repeated full-file writes.
- This is a hidden cost attached to local user actions.

Tangible fix:

- Change the log to append-only JSONL.
- Batch fsync/write on a short debounce.
- Rotate files by size/date.
- Encrypt or avoid storing sensitive task/event content if the log is not strictly needed in production.

Validation:

- Record 1,000 local mutations and compare total IO before/after.

### P2: Lookup helpers remain linear in places where dictionaries should exist

Evidence:

- `AppModel.task(id:)` and `AppModel.event(id:)` scan arrays.
- Several views search task lists or calendars by ID/title during rendering or searching.
- `AppModel.rebuildSnapshots()` already centralizes index work, so dictionaries fit the existing design.

Why this hurts UX:

- A single linear scan is not a disaster, but repeated scans inside body evaluation, menus, search, and bulk operations become visible.

Tangible fix:

- Add and maintain:
  - `tasksByID`
  - `eventsByID`
  - `taskListsByID`
  - `calendarsByID`
  - lowercased title indexes where search needs them.
- Update all rendering/search paths that repeatedly call `.first(where:)`.

Validation:

- Time bulk operations and search with thousands of tasks/events.

### P2: Store and notes views have avoidable repeated work

Evidence:

- `StoreView.datedTasks` filters all tasks every body.
- Completed counts in list menus filter tasks even though `taskListCompletionStats` already exists.
- Notes ordering uses `contains` checks on arrays, which is O(n^2) as the list grows.
- Notes order rebuild runs on any `model.tasks` change.

Why this hurts UX:

- Store and notes are everyday views.
- Repeated array filtering and O(n^2) ordering become noticeable as the user's dataset grows.

Tangible fix:

- Use `taskListCompletionStats` for completed counts.
- Use `tasksByDueDate` for dated tasks.
- Convert `localOrder` membership checks to `Set`.
- Rebuild note ordering only when note-related tasks change, or key it on `taskRevision + notesFilterRevision`.

Validation:

- Load 2,000 notes/tasks and profile switching tabs, opening menus, and reordering notes.

### P2: Near-realtime polling should adapt to app and network state

Evidence:

- `BackoffPolicy.nearRealtime` starts at 90 seconds and caps at 600 seconds.
- `MacSidebarShell.runNearRealtimeSyncLoop` skips offline but does not appear to throttle on constrained networks, app inactivity, low power, or minimized windows.
- `NetworkReachability` already exposes a constrained state.

Why this hurts UX:

- Background sync should not steal responsiveness from active local interactions.
- On constrained or expensive networks, polling can create user-visible slowdown and battery drain.

Tangible fix:

- Pause or slow near-realtime polling when:
  - network is constrained,
  - app window is minimized or inactive,
  - low power mode is active,
  - a manual sync just completed.
- Resume faster cadence when the app becomes active.

Validation:

- Measure CPU/network while idle for 30 minutes with the app focused and unfocused.

### P2: Location/geocoding and map previews need caching

Evidence:

- Location previews debounce geocoding, but there is no clear durable geocode cache.
- Expanded maps use a `WKWebView`, which is expensive but acceptable if isolated.

Why this hurts UX:

- Reopening the same event/location can redo work and show avoidable loading delays.

Tangible fix:

- Add an in-memory LRU and small persistent cache keyed by normalized address.
- Avoid creating web map views until the user explicitly expands.

Validation:

- Reopen the same location repeatedly and verify no repeated geocode requests.

## Immediate implementation checklist

These are small or medium changes that should noticeably improve perceived speed without a full rewrite.

1. Add resource revisions in `AppModel` or the future stores.
2. Replace count-based cache keys in month, week, and command palette with revisions.
3. Use `eventsByDay` and `tasksByDueDate` in calendar agenda and menu bar agenda.
4. Convert kanban column stacks to lazy stacks.
5. Cache kanban grouped columns by task/list/settings revisions.
6. Compile command palette regex once per query.
7. Add dictionaries for tasks, events, lists, and calendars by ID.
8. Use `taskListCompletionStats` instead of refiltering for completed counts.
9. Make notes ordering set-based instead of array-contains-based.
10. Increase Calendar event page size after API confirmation and add sync concurrency caps.
11. Remove `.prettyPrinted` and `.sortedKeys` from release cache encoding.
12. Decouple notification scheduling from Spotlight indexing.

## Larger refactors worth planning

### Split the root model

Do this after the immediate cache-key and side-effect fixes. The goal is not abstraction for its own sake; the goal is to reduce SwiftUI invalidation and make hot paths independently measurable.

Recommended migration order:

1. Extract read-only derived indexes from `AppModel` into `TaskIndex` and `EventIndex`.
2. Extract task mutations into `TaskStore`.
3. Extract event mutations into `EventStore`.
4. Move settings and selections into `SettingsStore`.
5. Leave `AppModel` as a coordinator until screens are moved to narrow dependencies.

### Make integrations incremental

Notifications, Spotlight, local cache, audit log, and sync should be separate queues with separate debounce windows and separate metrics. A task checkbox should update local UI first, queue external work second, and let sync/integrations finish after.

### Consider SQLite when data reaches the threshold

The current JSON cache is simpler and probably fine for moderate users. Move to SQLite only when measurements show that whole-file JSON decode/encode or memory pressure is a real limit. The likely trigger is large calendar history or future support for very large task/note datasets.

## Measurement plan

Add `AppLogger.performance` timing around these exact spans:

- app launch start to first window visible,
- cache decode duration and file sizes,
- `AppModel.apply(...)`,
- `AppModel.rebuildSnapshots()`,
- month/week grid cache rebuild duration,
- command palette entity snapshot build duration,
- command palette query duration,
- notification sync duration,
- Spotlight indexing duration,
- cache encode/write duration,
- sync request count, page count, and total duration.

Run these Instruments scenarios:

1. Cold launch with cached data: 2,000 tasks, 10,000 events.
2. Cold launch with large cached data: 5,000 tasks, 50,000 events.
3. Manual sync while month view is visible.
4. Near-realtime sync flush while the user scrolls calendar.
5. Toggle 100 tasks quickly.
6. Drag-create and drag-resize events in week/month views.
7. Open command palette and search normal, structured, and regex queries.
8. Scroll kanban with 1,000 and 5,000 tasks.
9. Type continuously in a long markdown note.
10. Open menu bar agenda during sync.

Suggested budgets:

- Cached launch to useful UI: under 1.5 seconds at 10,000 events, under 3 seconds at 50,000 events.
- Checkbox toggle visible feedback: under 100 ms.
- Calendar drag visual feedback: under 50 ms.
- Command palette normal query: first results under 150 ms.
- Command palette regex query: first results under 300 ms.
- Month/week scroll and drag: no obvious frame drops; target 60 fps on typical datasets.
- Kanban scroll: 60 fps below 1,000 tasks; still usable at 5,000 tasks.
- Background sync: should not block text input, drag gestures, or command palette display.

## Risk ordering

Fix first:

- Cache correctness: count-based keys can show stale UI.
- Full Spotlight/notification rebuilds on mutation paths.
- Kanban non-lazy rendering.
- Remaining full-array scans in calendar/menu surfaces.

Fix second:

- Command palette regex compilation and structured lookup indexes.
- Sync page size and concurrency caps.
- Release cache encoding format.
- Notes/Store repeated filtering.

Plan but do not rush without traces:

- Full `AppModel` store split.
- SQLite persistence.
- Markdown incremental renderer.

## Bottom line

The app is already moving in the right direction: it has local cache, derived indexes, debounced writes, and some grid-level caching. The urgent work is to make those optimizations correct, narrow, and isolated from user interactions.

The biggest product improvement will come from treating local UI response as the primary transaction: update the visible state first, then let Google sync, cache persistence, Spotlight, notifications, and audit logging settle in the background with explicit debouncing and metrics.
