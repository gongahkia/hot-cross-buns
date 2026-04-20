import SwiftUI

// Tasks tab, post-sidebar-refactor. Kanban is the one and only view — the
// list view, view-mode picker, smart-filter menu, and Store-filter routing
// all retired with the Calendar / Tasks / Notes split.
//
// What still lives here:
//  - Kanban board (group-by picker retained; click empty space to add a task
//    to that column's list).
//  - Inspector (Cmd+I) for the selected task.
//  - Clear-completed bulk helper.
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
    @Environment(RouterPath.self) private var router

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
            .toolbar {
                ToolbarItemGroup {
                    if selection.count > 1 {
                        bulkActionButtons
                    }
                    if model.pendingMutations.count > 0 {
                        PendingSyncPill(count: model.pendingMutations.count)
                    }
                    Button {
                        newListTitle = ""
                        isCreatingList = true
                    } label: {
                        Label("New List", systemImage: "plus.rectangle.on.rectangle")
                    }
                    .help("Create a new Google Tasks list")
                    .disabled(isDisconnected || isMutatingList)
                    clearCompletedMenu
                        .disabled(isDisconnected)
                }
            }
            .background(
                Button("Toggle Inspector") {
                    isInspectorPresented.toggle()
                }
                .hcbKeyboardShortcut(.storeShowInspector)
                .opacity(0)
                .hcbScaledFrame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            )
            .background(
                Button("Delete Selected") {
                    Task { await deleteSelection() }
                }
                .hcbKeyboardShortcut(.storeClearCompleted)
                .opacity(0)
                .hcbScaledFrame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            )
            .inspector(isPresented: inspectorBinding) {
                inspectorContent
                    .appBackground()
                    .inspectorColumnWidth(min: 340, ideal: 380, max: 520)
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
            .sheet(isPresented: $isCreatingList) {
                ListCreateSheet(
                    title: $newListTitle,
                    onCancel: {
                        isCreatingList = false
                        newListTitle = ""
                    },
                    onCreate: { Task { await createNewList() } }
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

    private func snoozeDate(daysFromNow days: Int) -> Date {
        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        return cal.date(byAdding: .day, value: days, to: startOfToday) ?? startOfToday
    }

    private func snooze(_ task: TaskMirror, to newDate: Date?) async {
        _ = await model.updateTask(task, title: task.title, notes: task.notes, dueDate: newDate)
    }

    private func completedCount(in listID: TaskListMirror.ID) -> Int {
        model.tasks.filter { $0.taskListID == listID && $0.isCompleted && $0.isDeleted == false }.count
    }

    @ViewBuilder
    private var clearCompletedMenu: some View {
        Menu {
            if visibleTaskLists.isEmpty {
                Button("No task lists") {}.disabled(true)
            } else {
                ForEach(visibleTaskLists) { list in
                    let n = completedCount(in: list.id)
                    Button {
                        Task { _ = await model.clearCompletedTasks(in: list.id) }
                    } label: {
                        Text("\(list.title) (\(n))")
                    }
                    .disabled(n == 0)
                }
            }
        } label: {
            Label("Clear Completed", systemImage: "eraser")
        }
        .help("Hide completed tasks from a list (uses Google's batch clear)")
    }

    private var visibleTaskLists: [TaskListMirror] {
        let visible = visibleTaskListIDs
        return model.taskLists.filter { visible.contains($0.id) }
    }

    @ViewBuilder
    private var content: some View {
        ZStack(alignment: .bottom) {
            Group {
                if model.account == nil {
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
                        onClearCompleted: { list in
                            Task { _ = await model.clearCompletedTasks(in: list.id) }
                        },
                        onNewList: {
                            newListTitle = ""
                            isCreatingList = true
                        },
                        onCreateTaskInList: { listID in
                            router.present(.quickCreateTask(listID: listID))
                        }
                    )
                }
            }
            if selection.count >= 2 {
                TaskBulkActionBar(
                    selection: $selection,
                    tasks: selectedTasksFromModel,
                    onFinished: handleBulkResult
                )
                .hcbScaledPadding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            BulkResultToast(message: $bulkResultMessage, isWarning: bulkResultIsWarning)
        }
        .animation(.easeInOut(duration: 0.2), value: selection.count >= 2)
    }

    // Tasks shown on the Tasks tab = dated, non-deleted, respecting the
    // user's per-list visibility pick. Undated tasks auto-route to Notes.
    private var datedTasks: [TaskMirror] {
        model.tasks.filter { task in
            task.isDeleted == false
                && task.dueDate != nil
                && visibleTaskListIDs.contains(task.taskListID)
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
        Binding(
            get: { isInspectorPresented && hasInspectableContent },
            set: { isInspectorPresented = $0 }
        )
    }

    private var hasInspectableContent: Bool {
        model.account != nil && model.tasks.isEmpty == false
    }

    @ViewBuilder
    private var inspectorContent: some View {
        if selection.count > 1 {
            BulkSelectionInspector(count: selection.count)
        } else if selection.count == 1, let id = selection.first, let task = model.task(id: id) {
            TaskInspectorView(task: task, close: {
                selection = []
                isInspectorPresented = false
            })
        } else {
            TaskInspectorEmptyState()
        }
    }

    private var visibleTaskListIDs: Set<TaskListMirror.ID> {
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
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(AppColor.cream.opacity(0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
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
                        .disabled(isMutating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Move") {
                        Task { await perform() }
                    }
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

private struct SnoozePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let task: TaskMirror
    let onSelect: (Date) -> Void

    @State private var pickedDate: Date = Date()

    var body: some View {
        NavigationStack {
            Form {
                Section("Snooze \(task.title) until") {
                    DatePicker("Date", selection: $pickedDate, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: [.date])
                        .datePickerStyle(.graphical)
                }
            }
            .navigationTitle("Snooze Task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Snooze") {
                        onSelect(Calendar.current.startOfDay(for: pickedDate))
                        dismiss()
                    }
                }
            }
        }
        .hcbScaledFrame(minWidth: 360, minHeight: 400)
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
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: onSave)
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

    var body: some View {
        NavigationStack {
            Form {
                Section("New list") {
                    TextField("Title", text: $title)
                }
            }
            .navigationTitle("New Task List")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", action: onCreate)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 380, minHeight: 180)
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
    @Environment(RouterPath.self) private var router

    @State private var searchQuery: String = ""
    // Local-order store — drag-to-reorder is view-local. We persist nothing
    // back to Google because Google Tasks position fields are already used
    // for intra-list ordering under the Tasks tab; overloading them for a
    // cross-list Notes order would fight server reconciliation. Rebuilt on
    // tasks change to pick up new undated items at the head.
    @State private var localOrder: [TaskMirror.ID] = []
    @State private var draggingID: TaskMirror.ID?

    private let columns: [GridItem] = [
        GridItem(.adaptive(minimum: 220, maximum: 280), spacing: 12, alignment: .top)
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if model.account == nil {
                    ContentUnavailableView(
                        "Not connected to Google",
                        systemImage: "person.crop.circle.badge.plus",
                        description: Text("Sign in to see undated tasks here.")
                    )
                } else if undatedTasks.isEmpty {
                    ContentUnavailableView(
                        searchQuery.isEmpty ? "No notes" : "No matches",
                        systemImage: "note.text",
                        description: Text(searchQuery.isEmpty
                                          ? "Tasks without a due date show up here. Use the + button to capture a quick thought."
                                          : "Adjust the search to see more notes.")
                    )
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                            ForEach(orderedTasks) { task in
                                NoteCard(task: task, isDragging: draggingID == task.id) {
                                    router.present(.editTask(task.id))
                                }
                                .draggable(DraggedTask(taskID: task.id, taskListID: task.taskListID, title: task.title)) {
                                    NoteDragPreview(title: task.title)
                                        .onAppear { draggingID = task.id }
                                }
                                .dropDestination(for: DraggedTask.self) { items, _ in
                                    guard let dropped = items.first else { return false }
                                    reorder(movingID: dropped.taskID, insertBefore: task.id)
                                    draggingID = nil
                                    return true
                                } isTargeted: { _ in }
                            }
                        }
                        .hcbScaledPadding(16)
                    }
                }
            }
            .appBackground()
        }
        .hcbSurface(.taskList)
        .toolbar {
            ToolbarItemGroup {
                Button {
                    router.present(.quickCreateTask(listID: nil))
                } label: {
                    Label("New Note", systemImage: "plus")
                }
                .help("Create a task without a due date")
                .disabled(model.account == nil)
            }
        }
        .onAppear { rebuildOrder() }
        .onChange(of: model.tasks) { _, _ in rebuildOrder() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search notes", text: $searchQuery)
                .textFieldStyle(.plain)
            Spacer(minLength: 8)
            Text("\(undatedTasks.count) note\(undatedTasks.count == 1 ? "" : "s")")
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 10)
    }

    private var undatedTasks: [TaskMirror] {
        let visible: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        let base = model.tasks.filter {
            $0.isDeleted == false
                && $0.isCompleted == false
                && $0.dueDate == nil
                && visible.contains($0.taskListID)
        }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.isEmpty == false else { return base }
        return base.filter {
            $0.title.localizedCaseInsensitiveContains(q) || $0.notes.localizedCaseInsensitiveContains(q)
        }
    }

    private var orderedTasks: [TaskMirror] {
        let pool = Dictionary(uniqueKeysWithValues: undatedTasks.map { ($0.id, $0) })
        let ordered = localOrder.compactMap { pool[$0] }
        let missing = undatedTasks.filter { pool[$0.id] != nil && localOrder.contains($0.id) == false }
        return ordered + missing
    }

    private func rebuildOrder() {
        let currentIDs = undatedTasks.map(\.id)
        let preserved = localOrder.filter(currentIDs.contains)
        let fresh = currentIDs.filter { preserved.contains($0) == false }
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

private struct NoteCard: View {
    @Environment(AppModel.self) private var model
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
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.92))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
            )
            .shadow(color: Color.black.opacity(isDragging ? 0.08 : 0.0), radius: 6, y: 2)
            .scaleEffect(isDragging ? 0.98 : 1.0)
            .animation(.easeOut(duration: 0.12), value: isDragging)
        }
        .buttonStyle(.plain)
    }

    private var listName: String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
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
