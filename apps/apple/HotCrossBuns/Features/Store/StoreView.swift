import SwiftUI

// Tasks tab, post-sidebar-refactor. Kanban is the one and only view — the
// list view, view-mode picker, smart-filter menu, and Store-filter routing
// all retired with the Calendar / Tasks / Notes split.
//
// What still lives here:
//  - Kanban board (group-by picker retained; click empty space to add a task
//    to that column's list).
//  - Inspector (Cmd+I) for the selected task.
//  - List rename / delete / create — reused by both the Kanban column menu
//    and the "New List" toolbar button.
//  - BulkResult toast + bulk-action bar on multi-select.
//
// What moved:
//  - Undated tasks now show in the Notes tab (NotesView).
//  - "Lists" management view is reachable via the Kanban column menu; the
//    standalone filter entry was dropped with the filter menu.
struct StoreView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var selection: Set<TaskMirror.ID> = []
    @State private var isInspectorPresented = true
    @State private var isBulkMoveSheetPresented = false
    @State private var snoozeCustomTask: TaskMirror?
    @State private var bulkResultMessage: String?
    @State private var bulkResultIsWarning: Bool = false
    @State private var renamingList: TaskListMirror?
    @State private var renameDraft: String = ""
    @State private var pendingListDeletion: TaskListMirror?
    @State private var isCreatingList: Bool = false
    @State private var newListTitle: String = ""
    @State private var isMutatingList: Bool = false
    @SceneStorage("storeKanbanColumnMode") private var kanbanColumnModeKey: String = KanbanColumnMode.byList.rawValue
    @State private var kanbanColumnMode: KanbanColumnMode = .byList

    private var isDisconnected: Bool {
        model.account == nil
    }

    var body: some View {
        content
            .hcbSurface(.taskList)
            .appBackground()
            .navigationTitle("Hot Cross Buns")
            .focusedSceneValue(\.storeCommandActions, storeCommandActions)
            .inspector(isPresented: inspectorBinding) {
                inspectorContent
                    .environment(\.routerPath, router) // inspector pane is hoisted out of NavigationStack env scope; re-inject so TaskInspectorView's @Environment(\.routerPath) resolves
                    .appBackground()
                    .inspectorColumnWidth(min: 340, ideal: 380, max: 520)
            }
            .toolbar {
                // must sit below .inspector so toolbar hosts at the window level (matches NotesView). attaching .toolbar above .inspector scopes it inside the main column and makes buttons hover over the inspector's header bar.
                ToolbarItemGroup {
                    if selection.count > 1 {
                        bulkActionButtons
                    }
                    if model.pendingMutations.count > 0 {
                        PendingSyncPill(count: model.pendingMutations.count)
                    }
                    // When a single task is open in the inspector, suppress
                    // the creation toolbar — the inspector's own close button
                    // is the path back, and these actions reading as hovering
                    // over the task pane looked visually confused.
                    if isInspectorPresented && selection.count == 1 {
                        EmptyView()
                    } else {
                        Button {
                            newListTitle = ""
                            isCreatingList = true
                        } label: {
                            Label("New List", systemImage: "plus.rectangle.on.rectangle")
                        }
                        .help("Create a new Google Tasks list")
                        .disabled(isDisconnected || isMutatingList)
                        .popover(isPresented: $isCreatingList, arrowEdge: .bottom) {
                            ListCreateSheet(
                                title: $newListTitle,
                                onCancel: {
                                    isCreatingList = false
                                    newListTitle = ""
                                },
                                onCreate: { Task { await createNewList() } }
                            )
                        }
                        Button {
                            router?.present(.quickCreateTask(listID: nil))
                        } label: {
                            Label("New Task", systemImage: "plus")
                        }
                        .help("Create a new task")
                        .disabled(isDisconnected)
                    }
                }
            }
            .sheet(isPresented: $isBulkMoveSheetPresented) {
                BulkMoveSheet(taskIDs: Array(selection)) { movedCount in
                    if movedCount > 0 { selection = [] }
                }
            }
            .sheet(item: $snoozeCustomTask) { task in
                SnoozePickerSheet(task: task) { newDate in
                    Task { await snooze(task, to: newDate) }
                }
            }
            .sheet(item: $renamingList) { list in
                ListRenameSheet(
                    list: list,
                    draft: $renameDraft,
                    onCancel: { renamingList = nil },
                    onSave: { Task { await renameCurrentList(list) } }
                )
            }
            .confirmationDialog(
                "Delete task list?",
                isPresented: Binding(
                    get: { pendingListDeletion != nil },
                    set: { if $0 == false { pendingListDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                if let list = pendingListDeletion {
                    Button("Delete \(list.title)", role: .destructive) {
                        Task { await deleteCurrentList(list) }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                if let list = pendingListDeletion {
                    Text("This deletes \"\(list.title)\" and all tasks in it from Google Tasks.")
                }
            }
            .onChange(of: selection) { _, newValue in
                if newValue.isEmpty == false { isInspectorPresented = true }
            }
            .onAppear {
                kanbanColumnMode = KanbanColumnMode(rawValue: kanbanColumnModeKey) ?? .byList
            }
            .onChange(of: kanbanColumnMode) { _, newValue in
                kanbanColumnModeKey = newValue.rawValue
            }
    }

    private var storeCommandActions: StoreCommandActions {
        StoreCommandActions(
            toggleInspector: { isInspectorPresented.toggle() },
            deleteSelectedTasks: { Task { await deleteSelection() } },
            canDeleteSelectedTasks: selection.isEmpty == false
        )
    }

    @ViewBuilder
    private var bulkActionButtons: some View {
        Text("\(selection.count) selected")
            .hcbFont(.caption, weight: .semibold)
            .foregroundStyle(.secondary)
        Button {
            selection = []
        } label: {
            Label("Clear selection", systemImage: "xmark.circle")
        }
        .help("Clear selection")
    }

    private func deleteSelection() async {
        guard selection.isEmpty == false else { return }
        let ops = selection.map { BulkTaskOperation.delete(taskId: $0) }
        let result = await model.performBulkTaskOperations(ops)
        handleBulkResult(result)
        if result.failedCount == 0 {
            selection.removeAll()
        } else {
            let failingIds = Set(result.failures.map(\.operation.taskId))
            selection = selection.intersection(failingIds)
        }
    }

    private func snooze(_ task: TaskMirror, to newDate: Date?) async {
        _ = await model.updateTask(task, title: task.title, notes: task.notes, dueDate: newDate)
    }

    @ViewBuilder
    private var content: some View {
        ZStack(alignment: .bottom) {
            Group {
                if model.account == nil && model.authState == .authenticating {
                    RestoringSessionPlaceholder()
                } else if model.account == nil {
                    signedOutPrompt
                } else if model.taskLists.isEmpty {
                    noTaskListsPrompt
                } else {
                    KanbanView(
                        tasks: datedTasks,
                        columnMode: $kanbanColumnMode,
                        selection: $selection,
                        onResult: handleBulkResult,
                        onRenameList: { list in
                            renameDraft = list.title
                            renamingList = list
                        },
                        onDeleteList: { list in pendingListDeletion = list },
                        onNewList: {
                            newListTitle = ""
                            isCreatingList = true
                        },
                        onCustomSnooze: { task in
                            snoozeCustomTask = task
                        },
                        onCreateTaskInList: { listID in
                            router?.present(.quickCreateTask(listID: listID))
                        }
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if selection.count >= 2 {
                TaskBulkActionBar(
                    selection: $selection,
                    tasks: selectedTasksFromModel,
                    onFinished: handleBulkResult
                )
                .hcbScaledPadding(.bottom, 16)
                .transition(HCBMotion.transition(.move(edge: .bottom).combined(with: .opacity), reduceMotion: reduceMotion))
            }
            BulkResultToast(message: $bulkResultMessage, isWarning: bulkResultIsWarning)
        }
        .animation(HCBMotion.animation(.easeInOut(duration: 0.2), reduceMotion: reduceMotion), value: selection.count >= 2)
    }

    // Tasks shown on the Tasks tab = dated, non-deleted, respecting the
    // user's per-list visibility pick. Undated tasks auto-route to Notes.
    // Completed tasks stay in the pool and render under each column's
    // disclosure section. Overdue hide mode still applies to open tasks.
    private var datedTasks: [TaskMirror] {
        let now = Date()
        return model.tasks.filter { task in
            guard task.isDeleted == false,
                  task.dueDate != nil,
                  visibleTaskListIDs.contains(task.taskListID)
            else { return false }
            if model.settings.shouldHideOverdueTask(task, now: now) { return false }
            return true
        }
    }

    private var selectedTasksFromModel: [TaskMirror] {
        selection.compactMap { model.task(id: $0) }
    }

    private func handleBulkResult(_ result: BulkTaskExecutionResult) {
        if result.nothingToDo {
            bulkResultIsWarning = false
            bulkResultMessage = "Nothing to do — all selected tasks were already in the requested state."
            return
        }
        if result.allSucceeded {
            var parts = ["\(result.succeeded) task\(result.succeeded == 1 ? "" : "s") updated."]
            if result.droppedAsNoOp > 0 {
                parts.append("\(result.droppedAsNoOp) skipped as no-op.")
            }
            bulkResultIsWarning = false
            bulkResultMessage = parts.joined(separator: " ")
            return
        }
        var parts = ["\(result.succeeded) updated, \(result.failedCount) failed"]
        if result.droppedAsNoOp > 0 {
            parts.append("\(result.droppedAsNoOp) skipped as no-op")
        }
        if let first = result.failures.first {
            parts.append("first failure — \(first.operation.summary): \(first.message)")
        }
        bulkResultIsWarning = true
        bulkResultMessage = parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var signedOutPrompt: some View {
        ContentUnavailableView {
            Label("Not connected to Google", systemImage: "person.crop.circle.badge.plus")
        } description: {
            Text("Connect your Google account in Settings to see your tasks here.")
        } actions: {
            Button("Open Settings") {
                NotificationCenter.default.post(name: .hcbOpenSettingsWindow, object: nil)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.ember)
        }
    }

    @ViewBuilder
    private var noTaskListsPrompt: some View {
        ContentUnavailableView {
            Label("No task lists yet", systemImage: "checklist")
        } description: {
            if case .syncing = model.syncState {
                Text("Loading your Google Tasks lists…")
            } else {
                Text("We haven't seen any task lists. Hit Refresh, or create one from the toolbar.")
            }
        } actions: {
            Button("Refresh") {
                Task { await model.refreshNow() }
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.ember)
        }
    }

    private var inspectorBinding: Binding<Bool> {
        // mirrors NotesView's noteInspectorBinding: only present when a task is selected. avoids the always-open empty-state pane on fresh load.
        Binding(
            get: { isInspectorPresented && selection.isEmpty == false },
            set: { isInspectorPresented = $0 }
        )
    }

    @ViewBuilder
    private var inspectorContent: some View {
        if selection.count > 1 {
            BulkSelectionInspector(count: selection.count)
        } else if selection.count == 1, let id = selection.first, let task = model.task(id: id) {
            TaskInspectorView(
                task: task,
                close: {
                    selection = []
                    isInspectorPresented = false
                },
                jumpToTask: { targetID in
                    selection = [targetID]
                    isInspectorPresented = true
                }
            )
            .id(task.id) // forces view teardown on task switch so draft @State and its auto-save commit are bound to the correct task. Without this, .onChange(of: task.id) fires AFTER self.task is already the new task, and commitPending writes the outgoing draft onto the incoming task.
        } else {
            TaskInspectorEmptyState()
        }
    }

    private var visibleTaskListIDs: Set<TaskListMirror.ID> {
        // Tasks-tab override wins; falls through to global list visibility
        // if the user hasn't configured a per-tab filter.
        if model.settings.hasConfiguredTasksTabSelection {
            return model.settings.tasksTabSelectedListIDs
        }
        if model.settings.hasConfiguredTaskListSelection {
            return model.settings.selectedTaskListIDs
        }
        return Set(model.taskLists.map(\.id))
    }

    private func renameCurrentList(_ list: TaskListMirror) async {
        let trimmed = renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isMutatingList = true
        defer { isMutatingList = false }
        _ = await model.updateTaskList(list, title: trimmed)
        renamingList = nil
    }

    private func createNewList() async {
        let trimmed = newListTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isMutatingList = true
        defer { isMutatingList = false }
        _ = await model.createTaskList(title: trimmed)
        isCreatingList = false
        newListTitle = ""
    }

    private func deleteCurrentList(_ list: TaskListMirror) async {
        isMutatingList = true
        defer {
            isMutatingList = false
            pendingListDeletion = nil
        }
        _ = await model.deleteTaskList(list)
    }
}

// MARK: - Bulk / rename / create / snooze helpers

private struct BulkSelectionInspector: View {
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.badge.questionmark")
                    .hcbFont(.title)
                    .foregroundStyle(AppColor.ember)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(count) tasks selected")
                        .hcbFont(.title3, weight: .semibold)
                    Text("Use the toolbar to complete, move, or delete them in bulk.")
                        .hcbFont(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .hcbScaledPadding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(AppColor.cream.opacity(0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
            )
            Text("Cmd-click to toggle individual rows, shift-click to extend the selection.")
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .hcbScaledPadding(20)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct BulkMoveSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let taskIDs: [TaskMirror.ID]
    let onComplete: (Int) -> Void

    @State private var destinationListID: TaskListMirror.ID?
    @State private var isMutating = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Move \(taskIDs.count) task\(taskIDs.count == 1 ? "" : "s") to:")
                        .hcbFont(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Section("Destination list") {
                    Picker("List", selection: $destinationListID) {
                        ForEach(model.taskLists) { list in
                            Text(list.title).tag(Optional(list.id))
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
            }
            .navigationTitle("Move tasks")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                        .disabled(isMutating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Move") {
                        Task { await perform() }
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(destinationListID == nil || isMutating || taskIDs.isEmpty)
                }
            }
            .task {
                destinationListID = destinationListID ?? model.taskLists.first?.id
            }
        }
        .hcbScaledFrame(minWidth: 320, minHeight: 320)
        .interactiveDismissDisabled(isMutating)
    }

    private func perform() async {
        guard let destination = destinationListID else { return }
        isMutating = true
        defer { isMutating = false }
        var moved = 0
        for id in taskIDs {
            guard let task = model.task(id: id), task.taskListID != destination else { continue }
            if await model.moveTaskToList(task, toTaskListID: destination) {
                moved += 1
            }
        }
        onComplete(moved)
        dismiss()
    }
}

struct TaskHoverPreview: View {
    @Environment(AppModel.self) private var model
    let task: TaskMirror

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                Text(TagExtractor.stripped(from: task.title))
                    .hcbFont(.headline)
                    .lineLimit(2)
            }
            HStack(spacing: 10) {
                Label(listName, systemImage: "list.bullet")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                if let due = task.dueDate {
                    Label(due.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()), systemImage: "calendar")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            let displayNotes = task.notes
            if displayNotes.isEmpty == false {
                Divider()
                Text.markdown(displayNotes)
                    .hcbFont(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(8)
            }
        }
        .hcbScaledPadding(12)
        .hcbScaledFrame(width: 300, alignment: .leading)
    }

    private var listName: String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
    }
}

struct ListRenameSheet: View {
    let list: TaskListMirror
    @Binding var draft: String
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Rename list") {
                    TextField("Title", text: $draft)
                }
            }
            .navigationTitle("Rename")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: onSave)
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 380, minHeight: 180)
    }
}

struct ListCreateSheet: View {
    @Binding var title: String
    let onCancel: () -> Void
    let onCreate: () -> Void
    @FocusState private var focused: Bool

    private var trimmed: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        // Compact popover body — matches Apple Reminders "New List" / Finder
        // rename-tag popovers. No NavigationStack + Form + Section, which
        // inside a small popover produces a stacked double-title visual with
        // awkward inset padding.
        VStack(alignment: .leading, spacing: 12) {
            Text("New Task List")
                .font(.headline)
            TextField("Name", text: $title)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit {
                    if trimmed.isEmpty == false { onCreate() }
                }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Create", action: onCreate)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(trimmed.isEmpty)
            }
        }
        .padding(16)
        .frame(width: 280)
        .onAppear { focused = true }
    }
}

// MARK: - NotesView
//
// Derived view of tasks with `dueDate == nil`. The classification is
// automatic — there's no local "is-a-note" flag. Adding a date to a Note
// moves it to the Tasks tab on the next render; clearing a date on a
// Tasks-tab task moves it here. This keeps two-way Google sync intact —
// Google Tasks sees only `due` changing, not a custom field.
//
// Layout is a Trello-style card grid. Cards are draggable (via `DraggedTask`)
// so they can be re-sorted within the grid (local order) or dropped onto
// the Tasks Kanban's date-bucket columns in the future. Click-to-create
// opens QuickCreatePopover in task-only mode with no pre-selected list.
struct NotesView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router

    // Local-order store — drag-to-reorder is view-local. We persist nothing
    // back to Google because Google Tasks position fields are already used
    // for intra-list ordering under the Tasks tab; overloading them for a
    // cross-list Notes order would fight server reconciliation. Rebuilt on
    // tasks change to pick up new undated items at the head.
    @State private var localOrder: [TaskMirror.ID] = []
    @State private var draggingID: TaskMirror.ID?
    @State private var kanbanSelection: Set<TaskMirror.ID> = []
    // Selected note opens in the side inspector (mirrors StoreView's pattern).
    // Tapping a NoteCard sets selectedNoteID; the .inspector modifier reveals
    // a TaskInspectorView for that note. Cleared when the user taps Close.
    @State private var selectedNoteID: TaskMirror.ID?
    @State private var isNoteInspectorPresented: Bool = true
    // List management state — mirrors StoreView's New-List flow so the Notes
    // toolbar can offer the same create-new-Google-Tasks-list affordance.
    @State private var isCreatingList: Bool = false
    @State private var newListTitle: String = ""
    @State private var isMutatingList: Bool = false

    // Notes never bucket by due-date. Leave list + tag only.
    private let notesKanbanModes: [KanbanColumnMode] = [.byList, .byTag]

    var body: some View {
        VStack(spacing: 0) {
            Group {
                if model.account == nil && model.authState == .authenticating {
                    RestoringSessionPlaceholder()
                } else if model.account == nil {
                    ContentUnavailableView(
                        "Not connected to Google",
                        systemImage: "person.crop.circle.badge.plus",
                        description: Text("Sign in to see undated tasks here.")
                    )
                } else if undatedTasks.isEmpty {
                    ContentUnavailableView {
                        Label("No notes", systemImage: "note.text")
                    } description: {
                        Text("Tasks without a due date show up here.")
                    } actions: {
                        Button {
                            router?.present(.quickCreateNote(listID: nil))
                        } label: {
                            Label("Create Note", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else {
                    kanbanContent
                }
            }
            // Content area fills the remaining space so the shared
            // appBackground on the outer VStack shows through uniformly
            // instead of the default white window chrome peeking around the
            // ContentUnavailableView card.
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .hcbSurface(.taskList)
        .appBackground()
        .navigationTitle("Hot Cross Buns")
        .inspector(isPresented: noteInspectorBinding) {
            noteInspectorContent
                .environment(\.routerPath, router)
                .appBackground()
                .inspectorColumnWidth(min: 340, ideal: 380, max: 520)
        }
        .toolbar {
            ToolbarItemGroup {
                // Mirror StoreView: suppress the create toolbar while a note
                // is open in the inspector so toolbar controls don't hover
                // above the task pane the user is editing.
                if isNoteInspectorPresented && selectedNoteID != nil {
                    EmptyView()
                } else {
                    Button {
                        newListTitle = ""
                        isCreatingList = true
                    } label: {
                        Label("New List", systemImage: "plus.rectangle.on.rectangle")
                    }
                    .help("Create a new Google Tasks list")
                    .disabled(model.account == nil || isMutatingList)
                    .popover(isPresented: $isCreatingList, arrowEdge: .bottom) {
                        ListCreateSheet(
                            title: $newListTitle,
                            onCancel: {
                                isCreatingList = false
                                newListTitle = ""
                            },
                            onCreate: { Task { await createNewListFromNotes() } }
                        )
                    }
                    Button {
                        router?.present(.quickCreateNote(listID: nil))
                    } label: {
                        Label("New Note", systemImage: "plus")
                    }
                    .help("Capture a thought without a due date. Adding a due date later moves it into the Tasks tab.")
                    .disabled(model.account == nil)
                }
            }
        }
        .onAppear { rebuildOrder() }
        .onChange(of: model.tasks) { _, _ in rebuildOrder() }
    }

    private func createNewListFromNotes() async {
        let trimmed = newListTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isMutatingList = true
        defer { isMutatingList = false }
        _ = await model.createTaskList(title: trimmed)
        isCreatingList = false
        newListTitle = ""
    }

    private var noteInspectorBinding: Binding<Bool> {
        Binding(
            get: { isNoteInspectorPresented && selectedNoteID != nil },
            set: { isNoteInspectorPresented = $0 }
        )
    }

    @ViewBuilder
    private var noteInspectorContent: some View {
        if let id = selectedNoteID, let task = model.task(id: id) {
            TaskInspectorView(
                task: task,
                close: {
                    selectedNoteID = nil
                    isNoteInspectorPresented = false
                },
                jumpToTask: { targetID in
                    selectedNoteID = targetID
                    isNoteInspectorPresented = true
                }
            )
            .id(task.id) // see StoreView.inspectorContent: same cross-task state-bleed fix applies here since Notes reuses TaskInspectorView.
        } else {
            TaskInspectorEmptyState()
        }
    }

    // MARK: - Kanban

    private var kanbanContent: some View {
        KanbanView(
            tasks: orderedTasks,
            columnMode: Binding(
                get: { model.settings.notesKanbanColumnMode },
                set: { model.setNotesKanbanColumnMode($0) }
            ),
            selection: $kanbanSelection,
            availableColumnModes: notesKanbanModes,
            onCreateTaskInList: { listID in
                router?.present(.quickCreateNote(listID: listID))
            },
            onCardTap: { task in
                selectedNoteID = task.id
                isNoteInspectorPresented = true
            }
        )
    }

    // MARK: - Shared cell

    @ViewBuilder
    private func noteCell(_ task: TaskMirror) -> some View {
        NoteCellWrapper(
            task: task,
            draggingID: draggingID,
            onTap: {
                selectedNoteID = task.id
                isNoteInspectorPresented = true
            },
            onDragStart: { draggingID = task.id },
            onDrop: { droppedID in
                reorder(movingID: droppedID, insertBefore: task.id)
                draggingID = nil
            }
        )
    }

    // MARK: - Filter resolution

    // Per-tab filter takes precedence over the global list selection; if
    // neither is configured, everything is visible.
    private var visibleListIDs: Set<TaskListMirror.ID> {
        if model.settings.hasConfiguredNotesTabSelection {
            return model.settings.notesTabSelectedListIDs
        }
        if model.settings.hasConfiguredTaskListSelection {
            return model.settings.selectedTaskListIDs
        }
        return Set(model.taskLists.map(\.id))
    }

    private var undatedTasks: [TaskMirror] {
        let visible = visibleListIDs
        return model.tasks.filter {
            $0.isDeleted == false
                && $0.dueDate == nil
                && visible.contains($0.taskListID)
        }
    }

    private var orderedTasks: [TaskMirror] {
        let pool = Dictionary(uniqueKeysWithValues: undatedTasks.map { ($0.id, $0) })
        let orderedSet = Set(localOrder)
        let ordered = localOrder.compactMap { pool[$0] }
        // Set.contains is O(1). Array.contains was O(n), making this filter
        // O(n²) for n notes — observable lag for users with hundreds+ notes
        // on every rebuildOrder / reorder tick.
        let missing = undatedTasks.filter { pool[$0.id] != nil && orderedSet.contains($0.id) == false }
        return ordered + missing
    }

    private func rebuildOrder() {
        let currentIDSet = Set(undatedTasks.map(\.id))
        let preserved = localOrder.filter(currentIDSet.contains)
        let preservedSet = Set(preserved)
        let fresh = undatedTasks.map(\.id).filter { preservedSet.contains($0) == false }
        localOrder = preserved + fresh
    }

    private func reorder(movingID: TaskMirror.ID, insertBefore targetID: TaskMirror.ID) {
        guard movingID != targetID else { return }
        var next = localOrder
        next.removeAll { $0 == movingID }
        if let idx = next.firstIndex(of: targetID) {
            next.insert(movingID, at: idx)
        } else {
            next.append(movingID)
        }
        localOrder = next
    }
}

// Wraps NoteCard to own the isTargeted state local to each row so drop-
// target highlighting is scoped per-cell. Keeping it out of the parent
// view avoids a full grid re-render on every dragEnter/Leave.
private struct NoteCellWrapper: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let task: TaskMirror
    let draggingID: TaskMirror.ID?
    let onTap: () -> Void
    let onDragStart: () -> Void
    let onDrop: (TaskMirror.ID) -> Void
    @State private var isTargeted = false

    var body: some View {
        NoteCard(task: task, isDragging: draggingID == task.id, onOpen: onTap)
            .overlay(alignment: .top) {
                if isTargeted {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(AppColor.ember)
                        .frame(height: 2)
                        .transition(HCBMotion.transition(.opacity, reduceMotion: reduceMotion))
                }
            }
            .animation(HCBMotion.animation(.easeOut(duration: 0.16), reduceMotion: reduceMotion), value: isTargeted)
            .draggable(DraggedTask(taskID: task.id, taskListID: task.taskListID, title: task.title)) {
                NoteDragPreview(title: task.title)
                    .onAppear { onDragStart() }
            }
            .dropDestination(for: DraggedTask.self) { items, _ in
                guard let dropped = items.first else { return false }
                onDrop(dropped.taskID)
                return true
            } isTargeted: { targeted in
                isTargeted = targeted
            }
    }
}

private struct NoteCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let task: TaskMirror
    let isDragging: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text(TagExtractor.stripped(from: task.title))
                        .hcbFont(.subheadline, weight: .semibold)
                        .foregroundStyle(AppColor.ink)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                let trimmed = task.notes
                if trimmed.isEmpty == false {
                    Text.markdown(trimmed)
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(6)
                        .multilineTextAlignment(.leading)
                }
                HStack(spacing: 6) {
                    Label(listName, systemImage: "list.bullet")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
            .hcbScaledPadding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
            )
            .shadow(color: Color.black.opacity(isDragging ? 0.08 : 0.0), radius: 6, y: 2)
            .scaleEffect(isDragging ? 0.98 : 1.0)
            .animation(HCBMotion.animation(.easeOut(duration: 0.12), reduceMotion: reduceMotion), value: isDragging)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(noteAccessibilityLabel)
        .contextMenu {
            Button {
                router?.present(.convertNoteToTask(task.id))
            } label: {
                Label("Convert to Task…", systemImage: "checklist")
            }
            Button {
                router?.present(.convertNoteToEvent(task.id))
            } label: {
                Label("Convert to Event…", systemImage: "calendar.badge.plus")
            }
        }
    }

    private var listName: String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
    }

    private var noteAccessibilityLabel: String {
        let title = TagExtractor.stripped(from: task.title)
        let notes = task.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if notes.isEmpty {
            return "Note: \(title), list \(listName)"
        }
        return "Note: \(title), \(notes), list \(listName)"
    }
}

private struct NoteDragPreview: View {
    let title: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "note.text")
            Text(title)
                .lineLimit(1)
        }
        .hcbFont(.caption, weight: .semibold)
        .hcbScaledPadding(.horizontal, 10)
        .hcbScaledPadding(.vertical, 6)
        .background(Capsule().fill(AppColor.ember.opacity(0.25)))
    }
}

// Shared placeholder used while authState == .authenticating and we don't
// yet know whether the user has a cached/restored Google session. Shows
// a native spinner + subtitle instead of the scary "Not connected" copy.
struct RestoringSessionPlaceholder: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text("Connecting to Google…")
                .hcbFont(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
