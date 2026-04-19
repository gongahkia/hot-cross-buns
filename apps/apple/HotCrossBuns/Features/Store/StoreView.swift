import SwiftUI

enum StoreFilter: Hashable {
    case all
    case smart(SmartListFilter)
    case notes
    case stale
    case custom(CustomFilterDefinition.ID)

    var storageKey: String {
        switch self {
        case .all: "all"
        case .smart(let f): "smart:\(f.rawValue)"
        case .notes: "notes"
        case .stale: "stale"
        case .custom(let id): "custom:\(id.uuidString)"
        }
    }

    init(storageKey: String) {
        if storageKey == "all" { self = .all; return }
        if storageKey == "notes" { self = .notes; return }
        if storageKey == "stale" { self = .stale; return }
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
        case .stale: "Stale Lists"
        case .custom: "Filter"
        }
    }

    var systemImage: String {
        switch self {
        case .all: "checklist"
        case .smart(let f): f.systemImage
        case .notes: "note.text"
        case .stale: "clock.badge.exclamationmark"
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
    @SceneStorage("storeFilter") private var filterKey: String = "all"
    @SceneStorage("storeShowCompleted") private var showCompleted: Bool = true

    private var filter: StoreFilter {
        StoreFilter(storageKey: filterKey)
    }

    // The inspector tracks the "focused" single task. Multi-select replaces
    // the detail view with a bulk-action summary so the user always knows
    // how many items a follow-up action will affect.
    private var primarySelection: TaskMirror.ID? {
        selection.count == 1 ? selection.first : nil
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
                    filterMenu
                    Button {
                        router.present(.manageTaskLists)
                    } label: {
                        Label("Manage Lists", systemImage: "list.bullet.rectangle")
                    }
                    Button {
                        router.present(.addTask)
                    } label: {
                        Label("Add Task", systemImage: "plus")
                    }
                    Toggle(isOn: $showCompleted) {
                        Label("Show Completed", systemImage: showCompleted ? "checkmark.circle.fill" : "checkmark.circle")
                    }
                    .toggleStyle(.button)
                    .help("Show completed tasks")
                    clearCompletedMenu
                    Button {
                        isInspectorPresented.toggle()
                    } label: {
                        Label("Toggle Inspector", systemImage: "sidebar.trailing")
                    }
                    .keyboardShortcut("i", modifiers: [.command])
                    .help("Toggle task details (Cmd+I)")
                }
            }
            .background(
                Button("Delete Selected") {
                    Task { await deleteSelection() }
                }
                .keyboardShortcut(.delete, modifiers: [.command])
                .opacity(0)
                .frame(width: 0, height: 0)
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
            .onChange(of: selection) { _, newValue in
                if newValue.isEmpty == false { isInspectorPresented = true }
            }
            .onChange(of: filterKey) { _, _ in
                selection = []
            }
    }

    @ViewBuilder
    private var bulkActionButtons: some View {
        Text("\(selection.count) selected")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        Button {
            Task { await bulkComplete() }
        } label: {
            Label("Complete", systemImage: "checkmark.circle")
        }
        .help("Mark all selected tasks complete")
        Button {
            isBulkMoveSheetPresented = true
        } label: {
            Label("Move", systemImage: "arrow.right.circle")
        }
        .help("Move selected tasks to another list")
        Button(role: .destructive) {
            Task { await bulkDelete() }
        } label: {
            Label("Delete", systemImage: "trash")
        }
        .help("Delete all selected tasks")
        Button {
            selection = []
        } label: {
            Label("Clear selection", systemImage: "xmark.circle")
        }
        .help("Clear selection")
    }

    private func bulkComplete() async {
        let ids = selection
        for id in ids {
            if let task = model.task(id: id), task.isCompleted == false {
                _ = await model.setTaskCompleted(true, task: task)
            }
        }
        selection = []
    }

    private func bulkDelete() async {
        let ids = selection
        for id in ids {
            if let task = model.task(id: id) {
                _ = await model.deleteTask(task)
            }
        }
        selection = []
    }

    private func deleteSelection() async {
        guard selection.isEmpty == false else { return }
        await bulkDelete()
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
        if model.account == nil {
            signedOutPrompt
        } else if model.taskLists.isEmpty {
            noTaskListsPrompt
        } else {
            scopedContent
        }
    }

    @ViewBuilder
    private var signedOutPrompt: some View {
        ContentUnavailableView {
            Label("Not connected to Google", systemImage: "person.crop.circle.badge.plus")
        } description: {
            Text("Connect your Google account in Settings to see your tasks and notes here.")
        } actions: {
            Button("Open Settings") {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
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

    @ViewBuilder
    private var scopedContent: some View {
        switch filter {
        case .all:
            allTasksList
        case .smart(let smart):
            flatList(filteredTasks: smartTasks(smart), emptyTitle: smart.emptyStateTitle, emptyMessage: smart.emptyStateMessage, emptyIcon: smart.systemImage)
        case .notes:
            flatList(filteredTasks: noteTasks, emptyTitle: "No notes", emptyMessage: "Tasks without a due date and with notes show up here. Add notes to a dateless task to use it as a note.", emptyIcon: "note.text")
        case .stale:
            staleListsView
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

    private var allTasksList: some View {
        List(selection: $selection) {
            ForEach(filteredSections()) { section in
                Section {
                    let nodes = TaskHierarchy.build(tasks: section.tasks)
                    if nodes.isEmpty {
                        Text(searchQuery.isEmpty ? "No tasks in this list" : "No matches")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(nodes) { node in
                            StoreTaskRow(task: node.parent, indentLevel: 0)
                                .tag(node.parent.id)
                                .contentShape(Rectangle())
                                .swipeActions(edge: .leading) { completeSwipe(for: node.parent) }
                            ForEach(node.children) { child in
                                StoreTaskRow(task: child, indentLevel: 1)
                                    .tag(child.id)
                                    .contentShape(Rectangle())
                                    .swipeActions(edge: .leading) { completeSwipe(for: child) }
                            }
                        }
                    }
                } header: {
                    taskListSectionHeader(for: section)
                }
            }
        }
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
                                .swipeActions(edge: .leading) { completeSwipe(for: task) }
                        }
                    } header: {
                        HStack(spacing: 8) {
                            Image(systemName: emptyIcon)
                            Text("\(filteredTasks.count) \(filteredTasks.count == 1 ? "task" : "tasks")")
                                .font(.caption.monospacedDigit())
                        }
                    }
                }
            }
        }
    }

    private var staleListsView: some View {
        let summaries = staleSummaries
        return Group {
            if summaries.isEmpty {
                ContentUnavailableView(
                    "No task lists",
                    systemImage: "clock.badge.exclamationmark",
                    description: Text("Connect Google to load your task lists.")
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        Text("Lists sorted by idle time. Stale = \(ReviewBuilder.staleAfterDays)+ days without activity.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(summaries) { summary in
                            staleCard(summary: summary)
                        }
                    }
                    .padding(16)
                }
            }
        }
    }

    private func staleCard(summary: ReviewListSummary) -> some View {
        let stale = (summary.daysSinceActivity ?? 0) >= ReviewBuilder.staleAfterDays
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Label(summary.taskList.title, systemImage: "checklist")
                    .font(.headline)
                Spacer(minLength: 0)
                if let days = summary.daysSinceActivity {
                    Text(days == 0 ? "Active today" : "\(days) day\(days == 1 ? "" : "s") idle")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(stale ? AppColor.ember : .secondary)
                } else {
                    Text("No activity recorded")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if summary.openTasks.isEmpty {
                Text("Inbox zero — all items complete.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 6) {
                    ForEach(summary.openTasks.prefix(5)) { task in
                        Button {
                            router.navigate(to: .task(task.id))
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "circle")
                                    .foregroundStyle(AppColor.ember)
                                Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                                    .font(.subheadline)
                                    .foregroundStyle(AppColor.ink)
                                Spacer(minLength: 0)
                                if let due = task.dueDate {
                                    Text(due.formatted(.dateTime.month(.abbreviated).day()))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(10)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(AppColor.cream.opacity(0.4))
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    if summary.openTasks.count > 5 {
                        Text("+\(summary.openTasks.count - 5) more")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(stale ? AppColor.ember.opacity(0.08) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(stale ? AppColor.ember.opacity(0.35) : AppColor.cardStroke, lineWidth: stale ? 1 : 0.6)
        )
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
            Button("Stale Lists") { filterKey = StoreFilter.stale.storageKey }
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
            get: { isInspectorPresented },
            set: { isInspectorPresented = $0 }
        )
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
        let base = model.tasks.filter { def.matches($0) }
        return applySearch(base)
    }

    private var staleSummaries: [ReviewListSummary] {
        ReviewBuilder.build(
            taskLists: model.taskLists,
            tasks: model.tasks,
            visibleTaskListIDs: visibleTaskListIDs
        )
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
        let allTasks = model.tasks.filter { $0.taskListID == section.taskList.id && $0.isDeleted == false }
        let total = allTasks.count
        let done = allTasks.filter(\.isCompleted).count
        let fraction = total == 0 ? 0 : Double(done) / Double(total)
        HStack(spacing: 10) {
            Text(section.taskList.title)
                .font(.subheadline.weight(.semibold))
            Spacer(minLength: 8)
            if total > 0 {
                Text("\(done)/\(total)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                ProgressView(value: fraction)
                    .progressViewStyle(.linear)
                    .tint(AppColor.moss)
                    .frame(width: 60)
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

private struct StoreTaskRow: View {
    let task: TaskMirror
    var indentLevel: Int = 0

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if indentLevel > 0 {
                Rectangle()
                    .fill(AppColor.cardStroke)
                    .frame(width: 2)
                    .padding(.leading, CGFloat(indentLevel) * 16)
            }
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .font(indentLevel > 0 ? .body : .title3)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    if TaskStarring.isStarred(task) {
                        Image(systemName: "star.fill")
                            .font(.caption)
                            .foregroundStyle(.yellow)
                    }
                    Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                        .font(indentLevel > 0 ? .subheadline.weight(.medium) : .headline)
                        .foregroundStyle(AppColor.ink)
                    ForEach(TagExtractor.tags(in: task.title), id: \.self) { tag in
                        Text("#\(tag)")
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(AppColor.blue.opacity(0.15))
                            )
                            .foregroundStyle(AppColor.blue)
                    }
                    if OptimisticID.isPending(task.id) {
                        Image(systemName: "icloud.slash")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .help("Pending sync with Google")
                    }
                }
                if !task.notes.isEmpty {
                    Text.markdown(task.notes)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let dueDate = task.dueDate {
                    Label(dueDate.formatted(.dateTime.month(.abbreviated).day()), systemImage: "calendar")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, indentLevel > 0 ? 6 : 0)
        .contentShape(Rectangle())
    }
}

private struct StoreSmartRow: View {
    let task: TaskMirror
    let listName: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                HStack(spacing: 8) {
                    Label(listName, systemImage: "list.bullet")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                    if let due = task.dueDate {
                        Label(relativeDueDateLabel(due), systemImage: "calendar")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(dueDateColor(due))
                    }
                }
                if !task.notes.isEmpty {
                    Text.markdown(task.notes)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
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
                    .font(.title)
                    .foregroundStyle(AppColor.ember)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(count) tasks selected")
                        .font(.title3.weight(.semibold))
                    Text("Use the toolbar to complete, move, or delete them in bulk.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(16)
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
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(20)
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
                        .font(.subheadline)
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
        .frame(minWidth: 320, minHeight: 320)
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
