# User-Facing Feature Parity Improvements

## Comparison Basis

Legacy reference repo:

- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/App`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/Features`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBuns/AppIntents`
- `/Users/gongahkia/Desktop/coding/projects/hot-cross-buns/apps/apple/HotCrossBunsShareExtension`

Current Electron rebuild:

- `src/renderer/src/App.tsx`
- `src/renderer/src/features/core/CoreScreens.tsx`
- `src/main/native`
- `docs/specs/core-app.md`
- `docs/specs/native-parity.md`

Hot Cross Buns 2 already has a usable shell, command palette, task/event/note CRUD surfaces, local search, settings, diagnostics, tray and hotkey scaffolding, and typed IPC. The gaps below are the user-visible surfaces the legacy macOS app has that are missing or materially thinner here.

## Improvements To Add

### 1. First-Run Onboarding And Setup

Legacy has a first-launch onboarding flow for Google sign-in, sync mode, task-list/calendar selection, and local reminders.

Add a Hot Cross Buns 2 onboarding route/modal that appears when local settings show no completed setup marker. It should guide the user through runtime Google OAuth client setup, selected task lists, selected calendars, sync mode, notification preference, and optional MCP access. Persist a setup completion timestamp in local settings and keep a Reset onboarding action in Settings.

Status on 2026-05-22:

- Implemented a first-run setup modal keyed by the local `setupCompletedAt` setting.
- The modal covers Google runtime/OAuth readiness, cached task-list selection, cached calendar selection, sync mode, notification preference, and optional MCP access.
- Completing setup persists selected resources, sync mode, notifications, MCP preference, and setup completion timestamp through existing settings IPC.
- Choosing local-only setup completes onboarding without Google selections and keeps local notes/settings available.
- Settings now has a non-destructive Reset onboarding action that clears only the completion timestamp.

Remaining blockers:

- Google OAuth client collection, Keychain token storage, authenticated Google transports, and sync scheduling are now implemented for macOS preview builds.
- Task-list and calendar choices still come from cached local rows; live Google account QA and first-sync resource-selection polish remain.
- MCP setup now controls the live listener and Keychain-backed bearer-token lifecycle; external MCP client QA remains.

Acceptance checks:

- Fresh local database opens onboarding before the main planner.
- Completing setup writes settings and returns to Today.
- Skipping Google still leaves local notes and settings usable.
- Reset onboarding reopens the flow without deleting planner data.

### 2. Advanced Search, Query DSL, And Custom Filters

Legacy has `AdvancedSearchQuery`, `AdvancedSearchMatcher`, `QueryDSL`, `CustomFilter`, fuzzy search, and settings search indexing.

Extend current local search beyond plain FTS. Add a parser for structured filters such as source, status, due/start date windows, list/calendar names, tags, priority, attendee, location, and notes/body presence. Expose this as chips in Search and as saved custom filters in Settings. Keep all search local-first.

Status on 2026-05-23:

- Implemented the first local structured search DSL slice for plain text plus `source:`/`domain:`, task `status:`, `due:` windows, event `start:` windows, task `priority:`, `list:`, `calendar:`/`cal:`, and `notes:`/`body:` presence.
- The renderer surfaces parsed filters as chips and shows inline invalid-query feedback without dispatching invalid search IPC.
- Main-process SQLite applies the same parsed filters, including filter-only searches, so matching remains local and bounded.
- Command palette now exposes Search and filter-syntax discovery.

Deferred:

- Saved custom filters/views are not added yet because stable saved-view storage should be introduced through settings or the local database in a dedicated pass.
- Fuzzy ranking, tag extraction, attendee/location-specific filters, settings search indexing, and full legacy `CustomFilter` parity remain out of scope for this slice.

Acceptance checks:

- Search supports plain text and structured filters in the same query.
- Invalid query syntax produces an inline, non-crashing error.
- Saved filters appear in the sidebar or Search section. Deferred for this slice; no second filter source of truth was added.
- Search does not call Google per keystroke.

### 3. Rich Calendar Planning

Legacy has agenda, day, week, month, and year calendar views, grid layout logic, drag/drop computation, quick-create popovers, recurrence editing, guest editing, reminders, location maps, hover previews, context menus, and bulk event actions.

Expand the current calendar surface into a full planning workspace. Keep agenda as the default low-risk view, then add day/week grids, month/year navigation, quick-create at date/time, event edit sheets, recurrence editor, guest/reminder controls, and local-only map preview fallback behavior.

Acceptance checks:

- Day and week views render large accounts without unbounded DOM growth.
- Quick-create pre-fills start/end from the clicked slot.
- Recurring event instances display correctly from cached Google data.
- Event guest and reminder validation matches IPC contract limits.

### 4. Task Power Workflows

Legacy has bulk task operations, task hierarchy support, snooze, task templates, natural-language task parsing, tag extraction, kanban grouping, task context menus, and a task inspector.

Add task productivity features in this order: hierarchy display/editing, bulk select/actions, snooze, templates, natural-language quick add, tag extraction, and kanban grouping. These should reuse the existing task write IPC and mutation queue so UI, MCP, and future shortcuts stay consistent.

Acceptance checks:

- Bulk complete/reopen/delete queues one mutation per affected Google task.
- Subtask moves cannot create cycles.
- Templates and natural-language parsing produce ordinary task create requests.
- Kanban grouping is a view over cached task data, not a second source of truth.

### 5. Import, Export, Review, Forecast, And Help

Legacy has ICS import, Today export/print, duplicate review, forecast/review builders, help localization, markdown rendering, and app command discoverability.

Add a utility layer around planner data: ICS import into cached calendar writes, local export for Today/task summaries, duplicate review, forecast/review summary views, localized Help, and Markdown preview for notes/details. Keep exports local and explicit.

Acceptance checks:

- Import preview shows what will be created before writing.
- Export files redact credentials and do not include raw Google payloads.
- Duplicate review can dismiss or merge candidates without deleting Google data unexpectedly.
- Help content is available offline.

### 6. Native User Surfaces

Legacy has a menu-bar app, Spotlight indexing, App Shortcuts, share extension, deep links, dock badge, open-at-login, and window restoration.

Hot Cross Buns 2 has tray/hotkey/deep-link scaffolding, but lacks full parity for system-wide discovery and capture. Add Spotlight-equivalent indexing where Electron/macOS permits it, a share-target alternative, dock/taskbar badge counts, durable open-at-login settings, and window restoration. App Shortcuts are native Swift-only, so treat them as a documented non-goal unless a small helper app is approved later.

Acceptance checks:

- Menu bar actions work after relaunch and when the main window is hidden.
- Share/capture flow accepts text and URLs without exposing Node APIs to renderer.
- Badge counts match incomplete overdue task state.
- Window size, position, and last section restore safely.

## Suggested First User-Facing Slice

Start with onboarding plus settings reset. It gives users a coherent first-run path and unlocks cleaner testing for Google setup, selections, notifications, and MCP without depending on the rest of feature parity.
