import SwiftUI

enum StoreFilter: Hashable {
    case all
    case smart(SmartListFilter)
    case notes
    case lists
    case custom(CustomFilterDefinition.ID)

    var storageKey: String {
        switch self {
        case .all: "all"
        case .smart(let f): "smart:\(f.rawValue)"
        case .notes: "notes"
        case .lists: "lists"
        case .custom(let id): "custom:\(id.uuidString)"
        }
    }

    init(storageKey: String) {
        if storageKey == "all" { self = .all; return }
        if storageKey == "notes" { self = .notes; return }
        if storageKey == "lists" { self = .lists; return }
        // Legacy: treat old "stale" storageKey as the new lists view.
        if storageKey == "stale" { self = .lists; return }
        if storageKey.hasPrefix("smart:"), let f = SmartListFilter(rawValue: String(storageKey.dropFirst(6))) {
            self = .smart(f)
            return
        }
        if storageKey.hasPrefix("custom:"), let uuid = UUID(uuidString: String(storageKey.dropFirst(7))) {
            self = .custom(uuid)
            return
        }
        self = .all
    }

    var title: String {
        switch self {
        case .all: "All Tasks"
        case .smart(let f): f.title
        case .notes: "Notes"
        case .lists: "Lists"
        case .custom: "Filter"
        }
    }

    var systemImage: String {
        switch self {
        case .all: "checklist"
        case .smart(let f): f.systemImage
        case .notes: "note.text"
        case .lists: "list.bullet.rectangle"
        case .custom: "line.3.horizontal.decrease.circle"
        }
    }
}

struct StoreView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

    @State private var selection: Set<TaskMirror.ID> = []
    @State private var isInspectorPresented = true
    @State private var searchQuery: String = ""
    @State private var isBulkMoveSheetPresented = false
    @State private var snoozeCustomTask: TaskMirror?
    @State private var bulkResultMessage: String?
    @State private var bulkResultIsWarning: Bool = false
    @SceneStorage("storeFilter") private var filterKey: String = "all"
    @SceneStorage("storeShowCompleted") private var showCompleted: Bool = true
    @SceneStorage("storeViewMode") private var viewModeKey: String = StoreViewMode.list.rawValue
    @SceneStorage("storeKanbanColumnMode") private var kanbanColumnModeKey: String = KanbanColumnMode.byList.rawValue
    @State private var kanbanColumnMode: KanbanColumnMode = .byList
    @State private var viewMode: StoreViewMode = .list

    private var filter: StoreFilter {
        StoreFilter(storageKey: filterKey)
    }

    // The inspector tracks the "focused" single task. Multi-select replaces
    // the detail view with a bulk-action summary so the user always knows
    // how many items a follow-up action will affect.
    private var primarySelection: TaskMirror.ID? {
        selection.count == 1 ? selection.first : nil
    }

    private var isDisconnected: Bool {
        model.account == nil
    }

    var body: some View {
        content
            .appBackground()
            .navigationTitle(navigationTitle)
            .searchable(text: $searchQuery, placement: .sidebar, prompt: "Filter")
            .toolbar {
                ToolbarItemGroup {
                    if selection.count > 1 {
                        bulkActionButtons
                    }
                    if model.pendingMutations.count > 0 {
                        PendingSyncPill(count: model.pendingMutations.count)
                    }
                    if visibleStoreViewModes.count > 1 {
                        viewModePicker
                            .disabled(isDisconnected)
                    }
                    filterMenu
                        .disabled(isDisconnected)
                    Button {
                        router.present(.manageTaskLists)
                    } label: {
                        Label("Manage Lists", systemImage: "list.bullet.rectangle")
                    }
                    .disabled(isDisconnected)
                    Button {
                        router.present(.addTask)
                    } label: {
                        Label("Add Task", systemImage: "plus")
                    }
                    .disabled(isDisconnected)
                    Toggle(isOn: $showCompleted) {
                        Label("Show Completed", systemImage: showCompleted ? "checkmark.circle.fill" : "checkmark.circle")
                    }
                    .toggleStyle(.button)
                    .help("Show completed tasks")
                    .disabled(isDisconnected)
                    clearCompletedMenu
                        .disabled(isDisconnected)
                    Button {
                        isInspectorPresented.toggle()
                    } label: {
                        Label("Toggle Inspector", systemImage: "sidebar.trailing")
                    }
                    .hcbKeyboardShortcut(.storeShowInspector)
                    .help("Toggle task details (Cmd+I)")
                    .disabled(isDisconnected)
                }
            }
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
                    .inspectorColumnWidth(min: 340, ideal: 380, max: 520)
            }
            .sheet(isPresented: $isBulkMoveSheetPresented) {
                BulkMoveSheet(taskIDs: Array(selection)) { movedCount in
                    if movedCount > 0 {
                        selection = []
                    }
                }
            }
            .sheet(item: $snoozeCustomTask) { task in
                SnoozePickerSheet(task: task) { newDate in
                    Task { await snooze(task, to: newDate) }
                }
            }
            .onChange(of: selection) { _, newValue in
                if newValue.isEmpty == false { isInspectorPresented = true }
            }
            .onChange(of: filterKey) { _, _ in
                selection = []
            }
            .onAppear {
                consumePendingStoreFilter()
                // Restore persisted modes. Falls back to list + byList when
                // the stored keys are unrecognised (e.g., after a rename).
                viewMode = StoreViewMode(rawValue: viewModeKey) ?? .list
                kanbanColumnMode = KanbanColumnMode(rawValue: kanbanColumnModeKey) ?? .byList
            }
            .onChange(of: model.pendingStoreFilterKey) { _, _ in
                consumePendingStoreFilter()
            }
            .onChange(of: viewMode) { _, newValue in
                viewModeKey = newValue.rawValue
            }
            .onChange(of: kanbanColumnMode) { _, newValue in
                kanbanColumnModeKey = newValue.rawValue
            }
            .onChange(of: model.settings.hiddenStoreViewModes) { _, _ in
                // If the currently-selected view mode just got hidden, fall
                // back to the first still-visible mode.
                if visibleStoreViewModes.contains(viewMode) == false,
                   let first = visibleStoreViewModes.first {
                    viewMode = first
                }
            }
    }

    private var viewModePicker: some View {
        Picker("View", selection: $viewMode) {
            ForEach(visibleStoreViewModes, id: \.self) { mode in
                Label(mode.title, systemImage: mode.systemImage).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .fixedSize()
        .help("Switch between List and Kanban")
    }

    // Quick switcher (and future deep-link / intent paths) stage a filterKey
    // on AppModel; consume it here so navigation actually lands the user on
    // the requested surface. Cleared once applied so tab re-entries don't
    // reapply a stale value.
    private func consumePendingStoreFilter() {
        guard let key = model.pendingStoreFilterKey else { return }
        filterKey = key
        model.pendingStoreFilterKey = nil
    }

    @ViewBuilder
    private var bulkActionButtons: some View {
        // Toolbar displays only the count + clear. Actual actions live in the
        // floating TaskBulkActionBar so the toolbar doesn't balloon with menus.
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

    @ViewBuilder
    private func snoozeMenu(for task: TaskMirror) -> some View {
        Menu("Snooze") {
            Button("Tomorrow") { Task { await snooze(task, to: snoozeDate(daysFromNow: 1)) } }
            Button("In 2 days") { Task { await snooze(task, to: snoozeDate(daysFromNow: 2)) } }
            Button("Next week") { Task { await snooze(task, to: snoozeDate(daysFromNow: 7)) } }
            Button("Next weekend") { Task { await snooze(task, to: nextWeekendDate()) } }
            Divider()
            Button("Pick a date…") { snoozeCustomTask = task }
            if task.dueDate != nil {
                Divider()
                Button("Clear due date", role: .destructive) { Task { await snooze(task, to: nil) } }
            }
        }
    }

    private func snoozeDate(daysFromNow days: Int) -> Date {
        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        return cal.date(byAdding: .day, value: days, to: startOfToday) ?? startOfToday
    }

    private func nextWeekendDate() -> Date {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let weekday = cal.component(.weekday, from: today)
        let daysUntilSaturday = (7 - weekday) % 7 == 0 ? 7 : (7 - weekday)
        return cal.date(byAdding: .day, value: daysUntilSaturday, to: today) ?? today
    }

    private func snooze(_ task: TaskMirror, to newDate: Date?) async {
        _ = await model.updateTask(task, title: task.title, notes: task.notes, dueDate: newDate)
    }

    // Completed-task counts per list drive the "Clear completed" menu so a
    // list with nothing completed is shown but disabled rather than hidden.
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

    private var navigationTitle: String {
        switch filter {
        case .custom(let id):
            model.settings.customFilters.first(where: { $0.id == id })?.name ?? "Filter"
        default:
            filter.title
        }
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
                    scopedContent
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

    private var selectedTasksFromModel: [TaskMirror] {
        // Resolve to live mirror rows so the bar's enable/disable state (e.g.,
        // "Star" vs "Unstar") reflects up-to-date task state, including any
        // optimistic changes from an in-flight bulk batch.
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
            Text("Connect your Google account in Settings to see your tasks and notes here.")
        } actions: {
            Button("Open Settings") {
                NotificationCenter.default.post(name: .hcbOpenSettingsTab, object: nil)
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
                Text("We haven't seen any task lists. Hit Refresh or create one with the Manage Lists button above.")
            }
        } actions: {
            Button("Refresh") {
                Task { await model.refreshNow() }
            }
            .buttonStyle(.borderedProminent)
            .tint(AppColor.ember)
        }
    }

    // StoreViewMode.allCases filtered by user-hidden set from §6.1 Layout.
    // Guarantees at least one visible by virtue of setStoreViewModeHidden's
    // invariant — but defensive fallback: if somehow empty, return [.list].
    private var visibleStoreViewModes: [StoreViewMode] {
        let filtered = StoreViewMode.allCases.filter {
            model.settings.hiddenStoreViewModes.contains($0.rawValue) == false
        }
        return filtered.isEmpty ? [.list] : filtered
    }

    // When filter == .lists the task-lists-management surface has no kanban
    // analogue, so we always force list mode there regardless of user choice.
    private var effectiveViewMode: StoreViewMode {
        if case .lists = filter { return .list }
        return visibleStoreViewModes.contains(viewMode) ? viewMode : (visibleStoreViewModes.first ?? .list)
    }

    @ViewBuilder
    private var scopedContent: some View {
        switch effectiveViewMode {
        case .list: listScopedContent
        case .kanban: kanbanScopedContent
        }
    }

    @ViewBuilder
    private var listScopedContent: some View {
        switch filter {
        case .all:
            allTasksList
        case .smart(let smart):
            flatList(filteredTasks: smartTasks(smart), emptyTitle: smart.emptyStateTitle, emptyMessage: smart.emptyStateMessage, emptyIcon: smart.systemImage)
        case .notes:
            flatList(filteredTasks: noteTasks, emptyTitle: "No notes", emptyMessage: "Tasks without a due date and with notes show up here. Add notes to a dateless task to use it as a note.", emptyIcon: "note.text")
        case .lists:
            TaskListsManagementView()
        case .custom(let id):
            if let def = model.settings.customFilters.first(where: { $0.id == id }) {
                flatList(filteredTasks: customFilterTasks(def), emptyTitle: "Nothing matches", emptyMessage: "Adjust the filter in Settings → Custom Filters.", emptyIcon: def.systemImage)
            } else {
                ContentUnavailableView(
                    "Filter was removed",
                    systemImage: "line.3.horizontal.decrease.circle",
                    description: Text("Open Settings → Custom Filters to manage filters.")
                )
            }
        }
    }

    // Kanban mode reuses the same filter pipeline the list modes use, then
    // hands the result to KanbanView for grouping + drag-and-drop. Selection
    // state is shared so picking a card in kanban and picking a row in list
    // feel the same.
    @ViewBuilder
    private var kanbanScopedContent: some View {
        let tasks = kanbanTasksForCurrentFilter()
        KanbanView(
            tasks: tasks,
            columnMode: $kanbanColumnMode,
            selection: $selection,
            onResult: handleBulkResult
        )
    }

    private func kanbanTasksForCurrentFilter() -> [TaskMirror] {
        switch filter {
        case .all:
            return applySearch(visibleTasks.filter { $0.isDeleted == false })
        case .smart(let smart):
            return smartTasks(smart)
        case .notes:
            return noteTasks
        case .lists:
            return [] // forced to list mode by effectiveViewMode
        case .custom(let id):
            guard let def = model.settings.customFilters.first(where: { $0.id == id }) else { return [] }
            return customFilterTasks(def)
        }
    }

    private var allTasksList: some View {
        List(selection: $selection) {
            ForEach(filteredSections()) { section in
                Section {
                    let nodes = TaskHierarchy.build(tasks: section.tasks)
                    if nodes.isEmpty {
                        Text(searchQuery.isEmpty ? "No tasks in this list" : "No matches")
                            .foregroundStyle(.secondary)
                            .listRowBackground(Color.clear)
                    } else {
                        ForEach(nodes) { node in
                            StoreTaskRow(task: node.parent, indentLevel: 0)
                                .tag(node.parent.id)
                                .contentShape(Rectangle())
                                .listRowBackground(Color.clear)
                                .swipeActions(edge: .leading) { completeSwipe(for: node.parent) }
                                .contextMenu { snoozeMenu(for: node.parent) }
                            ForEach(node.children) { child in
                                StoreTaskRow(task: child, indentLevel: 1)
                                    .tag(child.id)
                                    .contentShape(Rectangle())
                                    .listRowBackground(Color.clear)
                                    .swipeActions(edge: .leading) { completeSwipe(for: child) }
                                    .contextMenu { snoozeMenu(for: child) }
                            }
                        }
                    }
                } header: {
                    taskListSectionHeader(for: section)
                }
            }
        }
        .scrollContentBackground(.hidden)
    }

    private func flatList(filteredTasks: [TaskMirror], emptyTitle: String, emptyMessage: String, emptyIcon: String) -> some View {
        Group {
            if filteredTasks.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: emptyIcon,
                    description: Text(emptyMessage)
                )
            } else {
                List(selection: $selection) {
                    Section {
                        ForEach(filteredTasks) { task in
                            StoreSmartRow(task: task, listName: taskListName(for: task))
                                .tag(task.id)
                                .contentShape(Rectangle())
                                .listRowBackground(Color.clear)
                                .swipeActions(edge: .leading) { completeSwipe(for: task) }
                                .contextMenu { snoozeMenu(for: task) }
                        }
                    } header: {
                        HStack(spacing: 8) {
                            Image(systemName: emptyIcon)
                                .foregroundStyle(AppColor.ember)
                            Text("\(filteredTasks.count) \(filteredTasks.count == 1 ? "task" : "tasks")")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(AppColor.ink)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var filterMenu: some View {
        Menu {
            Button("All Tasks") { filterKey = StoreFilter.all.storageKey }
            Divider()
            Section("Smart") {
                Button("Overdue") { filterKey = StoreFilter.smart(.overdue).storageKey }
                Button("Due Today") { filterKey = StoreFilter.smart(.dueToday).storageKey }
                Button("Next 7 Days") { filterKey = StoreFilter.smart(.next7Days).storageKey }
                Button("No Date") { filterKey = StoreFilter.smart(.noDate).storageKey }
            }
            Divider()
            Button("Notes") { filterKey = StoreFilter.notes.storageKey }
            Button("Lists") { filterKey = StoreFilter.lists.storageKey }
            if model.settings.customFilters.isEmpty == false {
                Divider()
                Section("Custom") {
                    ForEach(model.settings.customFilters) { def in
                        Button {
                            filterKey = StoreFilter.custom(def.id).storageKey
                        } label: {
                            Label(def.name, systemImage: def.systemImage)
                        }
                    }
                }
            }
        } label: {
            Label(currentFilterLabel, systemImage: filter.systemImage)
        }
        .help("Change filter")
    }

    private var currentFilterLabel: String {
        switch filter {
        case .custom(let id):
            model.settings.customFilters.first(where: { $0.id == id })?.name ?? "Filter"
        default:
            filter.title
        }
    }

    private var inspectorBinding: Binding<Bool> {
        Binding(
            // Hide the inspector pane while there's nothing to inspect —
            // no account, or no tasks yet. As soon as tasks exist the pane
            // becomes available again and honours the user's toggle.
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
        } else if let id = primarySelection, let task = model.task(id: id) {
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

    private var visibleTasks: [TaskMirror] {
        model.tasks.filter { visibleTaskListIDs.contains($0.taskListID) }
    }

    private func smartTasks(_ f: SmartListFilter) -> [TaskMirror] {
        let base = f.apply(to: visibleTasks)
        return applySearch(base)
    }

    private var noteTasks: [TaskMirror] {
        let base = visibleTasks
            .filter { $0.isDeleted == false && $0.isCompleted == false }
            .filter { $0.dueDate == nil && $0.notes.isEmpty == false }
            .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
        return applySearch(base)
    }

    private func customFilterTasks(_ def: CustomFilterDefinition) -> [TaskMirror] {
        // def.filter(_:) compiles any DSL expression once, then evaluates across
        // all tasks. On compile failure it yields [] — an empty list, never a
        // list wider than the user's intent — so a malformed query fails loud
        // (via the red inline error in CustomFiltersSection) rather than quiet.
        let base = def.filter(
            model.tasks,
            now: Date(),
            calendar: .current,
            taskLists: model.taskLists
        )
        return applySearch(base)
    }

    private func applySearch(_ tasks: [TaskMirror]) -> [TaskMirror] {
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard q.isEmpty == false else { return tasks }
        return tasks.filter {
            $0.title.localizedCaseInsensitiveContains(q) || $0.notes.localizedCaseInsensitiveContains(q)
        }
    }

    private func filteredSections() -> [TaskListSectionSnapshot] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let sections: [TaskListSectionSnapshot]
        if showCompleted {
            sections = model.taskSections
        } else {
            sections = model.taskSections.map { section in
                TaskListSectionSnapshot(
                    taskList: section.taskList,
                    tasks: section.tasks.filter { $0.isCompleted == false }
                )
            }
        }
        guard query.isEmpty == false else { return sections }
        return sections.compactMap { section in
            let tasks = section.tasks.filter { matches(task: $0, query: query) }
            guard tasks.isEmpty == false else { return nil }
            return TaskListSectionSnapshot(taskList: section.taskList, tasks: tasks)
        }
    }

    private func matches(task: TaskMirror, query: String) -> Bool {
        if task.title.localizedCaseInsensitiveContains(query) { return true }
        if task.notes.localizedCaseInsensitiveContains(query) { return true }
        return false
    }

    @ViewBuilder
    private func taskListSectionHeader(for section: TaskListSectionSnapshot) -> some View {
        let stats = model.taskListCompletionStats[section.taskList.id] ?? TaskListCompletionStats(total: 0, completed: 0)
        return HStack(spacing: 10) {
            Text(section.taskList.title)
                .hcbFont(.subheadline, weight: .semibold)
            Spacer(minLength: 8)
            if stats.total > 0 {
                Text("\(stats.completed)/\(stats.total)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                ProgressView(value: stats.fraction)
                    .progressViewStyle(.linear)
                    .tint(AppColor.moss)
                    .hcbScaledFrame(width: 60)
            }
        }
    }

    @ViewBuilder
    private func completeSwipe(for task: TaskMirror) -> some View {
        Button {
            Task { await model.setTaskCompleted(!task.isCompleted, task: task) }
        } label: {
            Label(task.isCompleted ? "Reopen" : "Complete", systemImage: task.isCompleted ? "arrow.uturn.backward.circle" : "checkmark.circle")
        }
        .tint(task.isCompleted ? AppColor.blue : AppColor.moss)
    }

    private func taskListName(for task: TaskMirror) -> String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
    }
}

struct TaskListsManagementView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @State private var filter: String = ""
    @State private var renamingList: TaskListMirror?
    @State private var renameDraft: String = ""
    @State private var pendingDeletion: TaskListMirror?
    @State private var isCreating: Bool = false
    @State private var newListTitle: String = ""
    @State private var isMutating: Bool = false

    private var filteredLists: [TaskListMirror] {
        let q = filter.trimmingCharacters(in: .whitespaces)
        guard q.isEmpty == false else { return model.taskLists }
        return model.taskLists.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    private func taskCount(for listID: TaskListMirror.ID) -> Int {
        model.tasks.filter { $0.taskListID == listID && $0.isDeleted == false }.count
    }

    private func completedCount(for listID: TaskListMirror.ID) -> Int {
        model.tasks.filter { $0.taskListID == listID && $0.isCompleted && $0.isDeleted == false }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if filteredLists.isEmpty {
                ContentUnavailableView(
                    filter.isEmpty ? "No task lists" : "No matches",
                    systemImage: "list.bullet.rectangle",
                    description: Text(filter.isEmpty ? "Create a list to get started." : "Adjust the filter to see other lists.")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(filteredLists) { list in
                            listCard(list)
                        }
                    }
                    .hcbScaledPadding(16)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sheet(item: $renamingList) { list in
            renameSheet(list)
        }
        .sheet(isPresented: $isCreating) {
            createSheet
        }
        .confirmationDialog(
            "Delete task list?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if $0 == false { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let list = pendingDeletion {
                Button("Delete \(list.title)", role: .destructive) {
                    Task { await deleteList(list) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let list = pendingDeletion {
                Text("This deletes \"\(list.title)\" and all tasks in it from Google Tasks.")
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Filter lists", text: $filter)
                .textFieldStyle(.plain)
            Spacer(minLength: 8)
            Button {
                newListTitle = ""
                isCreating = true
            } label: {
                Label("New List", systemImage: "plus")
            }
            .disabled(model.account == nil || isMutating)
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 10)
    }

    private func listCard(_ list: TaskListMirror) -> some View {
        let total = taskCount(for: list.id)
        let done = completedCount(for: list.id)
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: "list.bullet.rectangle")
                .hcbFont(.title3)
                .foregroundStyle(AppColor.ember)
            VStack(alignment: .leading, spacing: 4) {
                Text(list.title)
                    .hcbFont(.headline)
                    .foregroundStyle(AppColor.ink)
                HStack(spacing: 10) {
                    Label("\(total) total", systemImage: "number")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                    Label("\(done) done", systemImage: "checkmark")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            Menu {
                Button {
                    renameDraft = list.title
                    renamingList = list
                } label: {
                    Label("Rename", systemImage: "pencil")
                }
                Button {
                    Task { _ = await model.clearCompletedTasks(in: list.id) }
                } label: {
                    Label("Clear Completed", systemImage: "eraser")
                }
                .disabled(done == 0)
                Divider()
                Button(role: .destructive) {
                    pendingDeletion = list
                } label: {
                    Label("Delete List", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .hcbFont(.title3)
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .hcbScaledPadding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(AppColor.cream.opacity(0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
        )
    }

    private func renameSheet(_ list: TaskListMirror) -> some View {
        NavigationStack {
            Form {
                Section("Rename list") {
                    TextField("Title", text: $renameDraft)
                }
            }
            .navigationTitle("Rename")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { renamingList = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await rename(list) }
                    }
                    .disabled(renameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 380, minHeight: 180)
    }

    private var createSheet: some View {
        NavigationStack {
            Form {
                Section("New list") {
                    TextField("Title", text: $newListTitle)
                }
            }
            .navigationTitle("New Task List")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isCreating = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await createList() }
                    }
                    .disabled(newListTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 380, minHeight: 180)
    }

    private func rename(_ list: TaskListMirror) async {
        let trimmed = renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isMutating = true
        defer { isMutating = false }
        _ = await model.updateTaskList(list, title: trimmed)
        renamingList = nil
    }

    private func createList() async {
        let trimmed = newListTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isMutating = true
        defer { isMutating = false }
        _ = await model.createTaskList(title: trimmed)
        isCreating = false
    }

    private func deleteList(_ list: TaskListMirror) async {
        isMutating = true
        defer {
            isMutating = false
            pendingDeletion = nil
        }
        _ = await model.deleteTaskList(list)
    }
}

private struct StoreTaskRow: View {
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    var indentLevel: Int = 0
    @State private var showPreview = false
    @State private var hoverTask: Task<Void, Never>?

    private var isBlocked: Bool {
        TaskDependencyMarkers.isBlocked(task, allTasks: model.tasks)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if indentLevel > 0 {
                Rectangle()
                    .fill(AppColor.cardStroke)
                    .hcbScaledFrame(width: 2)
                    .padding(.leading, CGFloat(indentLevel) * 16)
            }
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .font(indentLevel > 0 ? .body : .title3)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    if TaskStarring.isStarred(task) {
                        Image(systemName: "star.fill")
                            .hcbFont(.caption)
                            .foregroundStyle(.yellow)
                    }
                    Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                        .font(indentLevel > 0 ? .subheadline.weight(.medium) : .headline)
                        .foregroundStyle(AppColor.ink)
                    ForEach(TagExtractor.tags(in: task.title), id: \.self) { tag in
                        Text("#\(tag)")
                            .hcbFont(.caption, weight: .medium)
                            .hcbScaledPadding(.horizontal, 6)
                            .hcbScaledPadding(.vertical, 2)
                            .background(
                                Capsule().fill(AppColor.blue.opacity(0.15))
                            )
                            .foregroundStyle(AppColor.blue)
                    }
                    if OptimisticID.isPending(task.id) {
                        Image(systemName: "icloud.slash")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                            .help("Pending sync with Google")
                    }
                    if isBlocked {
                        Label("Blocked", systemImage: "lock.fill")
                            .hcbFont(.caption2, weight: .medium)
                            .hcbScaledPadding(.horizontal, 5)
                            .hcbScaledPadding(.vertical, 1)
                            .background(Capsule().fill(AppColor.ember.opacity(0.18)))
                            .foregroundStyle(AppColor.ember)
                    }
                }
                let displayNotes = TaskDependencyMarkers.strippedNotes(from: task.notes)
                if !displayNotes.isEmpty {
                    Text.markdown(displayNotes)
                        .hcbFont(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let dueDate = task.dueDate {
                    Label(dueDate.formatted(.dateTime.month(.abbreviated).day()), systemImage: "calendar")
                        .hcbFont(.caption, weight: .medium)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, indentLevel > 0 ? 6 : 0)
        .contentShape(Rectangle())
        .opacity(isBlocked && task.isCompleted == false ? 0.5 : 1.0)
        .onHover { hovering in
            hoverTask?.cancel()
            if hovering {
                hoverTask = Task {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    guard Task.isCancelled == false else { return }
                    await MainActor.run { showPreview = true }
                }
            } else {
                showPreview = false
            }
        }
        .popover(isPresented: $showPreview, arrowEdge: .trailing) {
            TaskHoverPreview(task: task)
        }
    }
}

private struct StoreSmartRow: View {
    let task: TaskMirror
    let listName: String
    @State private var showPreview = false
    @State private var hoverTask: Task<Void, Never>?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .hcbFont(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                    .hcbFont(.headline)
                    .foregroundStyle(AppColor.ink)
                HStack(spacing: 8) {
                    Label(listName, systemImage: "list.bullet")
                        .hcbFont(.caption, weight: .medium)
                        .foregroundStyle(.secondary)
                    if let due = task.dueDate {
                        Label(relativeDueDateLabel(due), systemImage: "calendar")
                            .hcbFont(.caption, weight: .medium)
                            .foregroundStyle(dueDateColor(due))
                    }
                }
                if !task.notes.isEmpty {
                    Text.markdown(task.notes)
                        .hcbFont(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onHover { hovering in
            hoverTask?.cancel()
            if hovering {
                hoverTask = Task {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    guard Task.isCancelled == false else { return }
                    await MainActor.run { showPreview = true }
                }
            } else {
                showPreview = false
            }
        }
        .popover(isPresented: $showPreview, arrowEdge: .trailing) {
            TaskHoverPreview(task: task)
        }
    }

    private func relativeDueDateLabel(_ due: Date) -> String {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfDue = calendar.startOfDay(for: due)
        let days = calendar.dateComponents([.day], from: startOfToday, to: startOfDue).day ?? 0
        if days < 0 { return "Overdue \(-days)d" }
        if days == 0 { return "Today" }
        if days == 1 { return "Tomorrow" }
        if days < 7 { return due.formatted(.dateTime.weekday(.wide)) }
        return due.formatted(.dateTime.month(.abbreviated).day())
    }

    private func dueDateColor(_ due: Date) -> Color {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfDue = calendar.startOfDay(for: due)
        if startOfDue < startOfToday { return AppColor.ember }
        if startOfDue == startOfToday { return AppColor.moss }
        return .secondary
    }
}

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
                if TaskStarring.isStarred(task) {
                    Image(systemName: "star.fill").foregroundStyle(.yellow)
                }
                Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
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
            let displayNotes = TaskDependencyMarkers.strippedNotes(from: task.notes)
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
