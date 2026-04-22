# TODO Tonight

Implementation plan for duplicate detection + history log, to be executed in a later session. Specs confirmed with user 2026-04-22. Build on top of existing infrastructure — do NOT replace. Must pass `make build` (unsigned variant: `CODE_SIGNING_ALLOWED=NO`).

## Style constraints (reminder)

All new views must adhere to the HCB macOS style kit already in use across the app:
- surfaces via `.hcbSurface(...)` (see `Design/HCBSurface.swift`)
- typography via `.hcbFont(...)` / `.hcbFontSystem(size:weight:)` (see `Design/HCBAppearance.swift`)
- spacing via `.hcbScaledPadding(...)` / `.hcbScaledFrame(...)`
- palette via `AppColor.*` (`Design/ColorSchemes.swift`) — `ember`, `moss`, `ink`, `cream`, `blue`
- no custom Material / color literals — reuse tokens so the app stays coherent with Apple Calendar / Reminders idioms
- cards use `RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.ultraThinMaterial)` (pattern already used in `TaskInspectorView.readCard`)
- new floating windows use `Window(...)` scene in `HotCrossBunsApp.swift` (not `WindowGroup`), `.windowResizability(.contentMinSize)`, match `Help` window's pattern at line 54-59

## Confirmed specs (from 2026-04-22 conversation)

### Duplicate detection
- Match key: exact case-SENSITIVE title AND exact notes body match.
- Scope: incomplete tasks + undated (incomplete) notes. Excluded: completed, deleted, events.
- Grouping: 2+ members = group. 3+ members handled identically (not just pairs).
- Visual: `!!` badge top-right of task card + note card. Clickable → opens inspector.
- Inspector actions: (a) jump to sibling, (b) delete this duplicate, (c) dismiss as false positive (persists per-group).
- Dismissal key: stable hash of SORTED member IDs; auto-invalidates if a member is edited (group composition changes → new hash).
- Events: NO badge on event blocks. Rationale — recurring meetings on the same day, identical daily standups, same meeting across multiple calendars are all normal; flagging would be noise.

### History log
- Build on existing `MutationAuditLog` (actor, persistent JSON at `~/Library/Application Support/<bundleID>/audit.log`) + `UndoableAction` enum.
- Record (ALL of): create, edit, duplicate, copy/paste/cut, move (list change, date change), complete/uncomplete, delete, restore, bulk ops (one entry, child count), sync events (diff-only).
- Sync events: OFF by default in history window; toggleable in settings. Still WRITTEN to audit log regardless.
- Visible cap: default 50. User-configurable in settings. Hard ceiling for storage: 5000 (existing) — surface as settings slider up to 50000 with MB estimate.
- Storage: plaintext JSON (existing). Add encryption TODO to bottom of `URGENT-TODO.md`.
- Undo: for ops where Google API supports reversal, offer an Undo button in the history window. For ops that can't be truly undone (hard deletes older than undo-stack TTL), show a "Copy snapshot" button that puts the pre-state JSON on the pasteboard so user can manually paste it back.
- UI: floating window (like Help / Settings), opened via menu item + keyboard shortcut (⌘⌥Y) + Settings link (all three).
- Per-category filter toggles visible in history window AND in settings (persisted).

## File-by-file plan

### New files

1. **`Services/Duplicates/DuplicateIndex.swift`** — pure Swift struct.
   ```
   struct DuplicateIndex {
       let groups: [String: Set<TaskMirror.ID>]  // groupKey -> member ids
       let memberToGroup: [TaskMirror.ID: String]
       static func build(tasks: [TaskMirror], dismissed: Set<String>) -> DuplicateIndex
       func groupKey(for id: TaskMirror.ID) -> String?
       func siblings(of id: TaskMirror.ID) -> [TaskMirror.ID]
   }
   ```
   - `build` filters `isCompleted == false && isDeleted == false`, normalizes nothing (exact case-sensitive), groups by `(title, notes)` tuple. Discards singletons. Computes groupKey = SHA256(sorted member IDs joined).
   - Returns empty group if dismissed set contains the key.
   - O(n) via Dictionary grouping.

2. **`Features/History/HistoryWindow.swift`** — root floating view.
   - Uses `NavigationStack` or plain `VStack`.
   - Top: filter chips (per category, toggleable, state bound to `AppSettings.historyCategoryFilters`).
   - Middle: `List` of entries with icon + summary + relative time + right-side action button (Undo / Copy snapshot).
   - Bottom: "Showing N of M entries" + "Clear all" destructive button.
   - Pulls from `MutationAuditLog.shared.recentEntries(limit: settings.historyVisibleLimit)`.

3. **`Features/History/HistoryEntryRow.swift`** — single-row view for the list.

4. **`Features/History/HistoryFilterChips.swift`** — filter bar.

5. **`Features/Settings/HistorySection.swift`** — settings subsection for history config. Add to existing `HCBSettingsWindow`'s sidebar.

### Modified files

6. **`Models/TaskMirror.swift`** (or wherever `TaskMirror` lives) — NO change. Duplicate detection computed externally.

7. **`App/AppModel.swift`**:
   - Add `@ObservationIgnored private var duplicateIndex: DuplicateIndex = DuplicateIndex(...)` and `private(set) var duplicateGroupKeyByTask: [TaskMirror.ID: String] = [:]` (derived).
   - Recompute whenever `tasks` or `settings.dismissedDuplicateGroups` change. Hook into existing `tasks` didSet / sync completion.
   - Helper: `func duplicateSiblings(of id: TaskMirror.ID) -> [TaskMirror]`.
   - Helper: `func dismissDuplicateGroup(containing id: TaskMirror.ID)`.
   - Helper: `func deleteDuplicate(_ task: TaskMirror) async`.
   - Extend `recordUndo` + add new call sites: `duplicateTask` (line ~similar), `createTask`, `createEvent`, `moveTaskToList` (line 341), `reorderTask`, bulk ops (find via grep for existing bulk funcs). Each new site records appropriate `UndoableAction` case.
   - Add sync-diff recording: wrap sync service's mirror-update path to emit `syncPulled(kind, diff)` audit entries when remote actually changed local mirror (NOT on every refresh tick).

8. **`Services/Sync/UndoAction.swift`** — extend enum:
   ```
   case taskCreate(snapshot: TaskMirror)
   case taskDuplicate(sourceID: TaskMirror.ID, newSnapshot: TaskMirror)
   case taskMove(taskID, fromListID, toListID, title)
   case taskReorder(taskID, priorSiblingID, title)
   case eventCreate(snapshot: CalendarEventMirror)
   case bulkAction(kind: String, count: Int, firstTitle: String)
   case syncPulled(kind: String, count: Int)  // diff-only
   case clipboardOp(kind: String, resourceID: String, title: String)  // copy/paste/cut
   ```
   - Extend `summary` + `sfSymbol` for each case.
   - Extend `AppModel.auditTuple(for:)` to map each.

9. **`Services/Logging/MutationAuditLog.swift`**:
   - Change `retentionLimit` from hardcoded 5000 to a settable value via init parameter or static var — wired to `AppSettings.historyStorageCap`.
   - Extend `MutationAuditEntry` with `priorSnapshotJSON: String?` and `postSnapshotJSON: String?` (optional, Codable-safe default nil for old entries).
   - Add `delete(id:)` method for per-entry removal (for "Undo" that invalidates the entry).

10. **`App/AppSettings.swift`** (find actual file; likely `Models/AppSettings.swift` or similar):
    - Add `historyVisibleLimit: Int = 50`.
    - Add `historyStorageCap: Int = 5000`.
    - Add `historyCategoryFilters: Set<String>` (default: all except `"sync"`).
    - Add `dismissedDuplicateGroups: Set<String> = []`.
    - Update `Codable` extension + setters on `AppModel`.

11. **`App/HotCrossBunsApp.swift`**:
    - Add `Window("History", id: "history") { HistoryWindow().environment(appModel) }` between Help and MenuBarExtra (line ~60).
    - `.defaultSize(width: 720, height: 560)`, `.windowResizability(.contentMinSize)`.

12. **`App/AppCommands.swift`**:
    - Add menu item under View menu (or similar): "History…" with shortcut ⌘⌥Y. Calls `openWindow(id: "history")`.

13. **`App/HCBShortcuts.swift`** (if keyboard shortcuts centralized there):
    - Add `showHistory = KeyboardShortcut("y", modifiers: [.command, .option])`.

14. **`Features/Tasks/TaskCard.swift`** (find actual file — it's the card view used in Kanban):
    - Add conditional `.overlay(alignment: .topTrailing) { DuplicateBadge() }` when `model.duplicateGroupKeyByTask[task.id] != nil`.
    - Badge: small pill with `Image(systemName: "exclamationmark.2")` (SF Symbol), `AppColor.ember` foreground, ultraThinMaterial backing, hcbScaledFrame sized.
    - Tap gesture → select task in list (opens inspector via existing flow).

15. **`Features/Tasks/TaskInspectorView.swift`**:
    - Add `duplicateBanner` view at top of both `isEditing` and view-only bodies (after `header`, before first content). Only rendered when `model.duplicateGroupKeyByTask[task.id] != nil`.
    - Banner content: "Duplicate of N other item(s)" + three buttons in HStack.
    - "Jump" → menu with sibling titles, selecting one posts selection change via router/selection binding.
    - "Delete this" → same confirmation dialog path as existing delete.
    - "Dismiss" → `model.dismissDuplicateGroup(containing: task.id)`.
    - Style: reuse `readCard` pattern with `AppColor.ember.opacity(0.08)` tinted background.

16. **Note card path** — check `NotesView` / `StoreView` note rendering for the cell used. Likely same `KanbanView` cell; if so, same badge treatment as tasks covers it.

17. **`URGENT-TODO.md`** — append at bottom:
    ```
    ## [Highest priority] Encrypt audit log at rest
    `audit.log` is plaintext JSON at ~/Library/Application Support/<bundleID>/audit.log.
    Contains task/note titles, bodies, and (with history-log expansion) snapshot
    payloads. Use CryptoKit symmetric AES-GCM with a Keychain-stored key, lazy
    migrate on first read when the `v2` header is absent.
    ```

## Execution order (tonight)

Build in this order so each step independently compiles and can be tested:

1. Extend `UndoableAction` enum + `AppModel.auditTuple`. Re-run build.
2. Extend `MutationAuditEntry` with optional snapshot fields. Verify old entries decode.
3. Add settings fields + codable migration. Verify settings load.
4. Wire new `recordUndo` call sites (duplicate/create/move/bulk). Verify audit log grows.
5. Add sync-diff recording hook. Verify sync ticks don't spam.
6. Build `DuplicateIndex` service + wire into `AppModel`. Verify via print/log that groups form correctly.
7. Add `!!` badge overlay to task/note cards. Verify visible on a manually-created duplicate.
8. Add inspector banner + three actions. Verify jump/delete/dismiss.
9. Build `HistoryWindow` + `HistoryEntryRow` + `HistoryFilterChips`. Verify it opens from menu.
10. Build `HistorySection` in settings. Wire toggles + sliders.
11. Wire ⌘⌥Y shortcut + menu item + Settings "Open History" button.
12. Append encryption TODO to `URGENT-TODO.md`.
13. Final `make build` pass. Manual smoke test: create 2 identical tasks → badge appears → open one → dismiss → badge clears for both → create 3rd identical → badge reappears.

## Open questions to resolve at start of next session

- Confirm actual filename + location of `AppSettings` (did not verify in this planning pass).
- Confirm filename of task card used in Kanban (likely `Features/Tasks/TaskCard.swift` or embedded in `KanbanView.swift`).
- Confirm the sync service entry point for diff-detection hook (likely `Services/Sync/SyncCoordinator.swift` or similar — grep for `reconcile` / `applyRemote`).

## Known risk

The state-bleed bug fix applied earlier (.id(task.id) on TaskInspectorView) means the inspector is now re-created per task. The duplicate banner relies on `model.duplicateGroupKeyByTask[task.id]` — this is read each body eval, so the fresh view correctly shows the right banner. No interaction risk. ✓
