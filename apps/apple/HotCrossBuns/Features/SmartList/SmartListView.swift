import SwiftUI

struct SmartListView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    let filter: SmartListFilter

    @State private var selection: TaskMirror.ID?
    @State private var isInspectorPresented = true

    var body: some View {
        Group {
            if filtered.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .appBackground()
        .navigationTitle(filter.title)
        .toolbar {
            ToolbarItemGroup {
                Button {
                    router.present(.addTask)
                } label: {
                    Label("Add Task", systemImage: "plus")
                }
                Button {
                    isInspectorPresented.toggle()
                } label: {
                    Label("Toggle Inspector", systemImage: "sidebar.trailing")
                }
                .keyboardShortcut("i", modifiers: [.command])
            }
        }
        .inspector(isPresented: inspectorBinding) {
            inspectorContent
                .inspectorColumnWidth(min: 340, ideal: 380, max: 520)
        }
        .onChange(of: selection) { _, newValue in
            if newValue != nil { isInspectorPresented = true }
        }
        .onChange(of: filter) { _, _ in
            selection = filtered.first?.id
        }
        .onAppear {
            if selection == nil {
                selection = filtered.first?.id
            }
        }
    }

    private var filtered: [TaskMirror] {
        let visibleTaskListIDs: Set<TaskListMirror.ID> = {
            if model.settings.hasConfiguredTaskListSelection {
                return model.settings.selectedTaskListIDs
            }
            return Set(model.taskLists.map(\.id))
        }()
        let tasks = model.tasks.filter { visibleTaskListIDs.contains($0.taskListID) }
        return filter.apply(to: tasks)
    }

    private var list: some View {
        List(selection: $selection) {
            Section {
                ForEach(filtered) { task in
                    SmartListRow(task: task, listName: taskListName(for: task))
                        .tag(task.id)
                        .contentShape(Rectangle())
                        .swipeActions(edge: .leading) {
                            Button {
                                Task { await model.setTaskCompleted(!task.isCompleted, task: task) }
                            } label: {
                                Label("Complete", systemImage: "checkmark.circle")
                            }
                            .tint(AppColor.moss)
                        }
                }
            } header: {
                HStack(spacing: 8) {
                    Image(systemName: filter.systemImage)
                    Text("\(filtered.count) \(filtered.count == 1 ? "task" : "tasks")")
                        .font(.caption.monospacedDigit())
                }
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            filter.emptyStateTitle,
            systemImage: filter.systemImage,
            description: Text(filter.emptyStateMessage)
        )
    }

    @ViewBuilder
    private var inspectorContent: some View {
        if let id = selection, let task = model.task(id: id) {
            TaskInspectorView(task: task, close: {
                selection = nil
                isInspectorPresented = false
            })
        } else {
            TaskInspectorEmptyState()
        }
    }

    private var inspectorBinding: Binding<Bool> {
        Binding(
            get: { isInspectorPresented },
            set: { isInspectorPresented = $0 }
        )
    }

    private func taskListName(for task: TaskMirror) -> String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
    }
}

private struct SmartListRow: View {
    let task: TaskMirror
    let listName: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "circle")
                .foregroundStyle(AppColor.ember)
                .font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text(task.title)
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
                    Text(task.notes)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Double tap to open.")
    }

    private var accessibilityText: String {
        var parts: [String] = [task.title, "in \(listName)"]
        if let due = task.dueDate {
            parts.append("due \(due.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))")
        }
        return parts.joined(separator: ", ")
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
