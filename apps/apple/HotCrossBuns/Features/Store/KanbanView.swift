import SwiftUI

// Kanban board host. Renders one scrollable column per KanbanColumn; each
// card is a DraggedTask that routes back to AppModel.performBulkTaskOperations
// via the column's KanbanDropIntent.
//
// Post-refactor responsibilities:
//  - Group-by picker (byList | byDueBucket | byTag)
//  - Column header dot + ⋯ menu (rename / delete / clear-completed), only
//    shown in `byList` mode where a header maps 1:1 to a Google task list.
//  - Empty-space tap inside a column → QuickCreatePopover in task-only mode
//    pre-filled with that column's list.
//  - Optional "New List…" button in the group-by header (byList only).
//
// Data-safety: drop-to-same-column is a no-op; invalid drops fail closed;
// every drop still routes through optimistic-write helpers so offline queue
// + etag conflict + undo paths apply unchanged.
struct KanbanView: View {
    @Environment(AppModel.self) private var model
    let tasks: [TaskMirror]
    @Binding var columnMode: KanbanColumnMode
    @Binding var selection: Set<TaskMirror.ID>
    var availableColumnModes: [KanbanColumnMode] = KanbanColumnMode.allCases
    var onResult: (BulkTaskExecutionResult) -> Void = { _ in }
    var onRenameList: (TaskListMirror) -> Void = { _ in }
    var onDeleteList: (TaskListMirror) -> Void = { _ in }
    var onClearCompleted: (TaskListMirror) -> Void = { _ in }
    var onNewList: () -> Void = {}
    var onCreateTaskInList: (TaskListMirror.ID?) -> Void = { _ in }

    @State private var dropHighlightColumnID: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(columns) { column in
                        KanbanColumnView(
                            column: column,
                            mode: columnMode,
                            taskList: taskList(for: column),
                            isDropTargeted: dropHighlightColumnID == column.id,
                            onDrop: { dropped in handleDrop(dropped, on: column) },
                            onDropTargetChanged: { isTargeted in
                                dropHighlightColumnID = isTargeted ? column.id : nil
                            },
                            selection: $selection,
                            onCardTap: { selection = [$0.id] },
                            onRenameList: onRenameList,
                            onDeleteList: onDeleteList,
                            onClearCompleted: onClearCompleted,
                            onCreateTask: { onCreateTaskInList(taskList(for: column)?.id) }
                        )
                    }
                    if columnMode == .byList {
                        newListColumn
                    }
                }
                .hcbScaledPadding(.horizontal, 16)
                .hcbScaledPadding(.vertical, 12)
            }
        }
    }

    private var columns: [KanbanColumn] {
        KanbanGrouping.columns(
            for: tasks,
            mode: columnMode,
            taskLists: model.taskLists,
            now: Date(),
            calendar: .current
        )
    }

    private func taskList(for column: KanbanColumn) -> TaskListMirror? {
        // Column IDs under byList follow "list-<id>" — see KanbanGrouping.
        guard columnMode == .byList, column.id.hasPrefix("list-") else { return nil }
        let listID = String(column.id.dropFirst("list-".count))
        return model.taskLists.first(where: { $0.id == listID })
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("Group by")
                .hcbFont(.caption, weight: .semibold)
                .foregroundStyle(.secondary)
            Picker("Group", selection: $columnMode) {
                ForEach(availableColumnModes, id: \.self) { m in
                    Label(m.title, systemImage: m.systemImage).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            Spacer(minLength: 0)
            Text("\(tasks.count) task\(tasks.count == 1 ? "" : "s")")
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 10)
    }

    private var newListColumn: some View {
        Button(action: onNewList) {
            VStack(spacing: 8) {
                Image(systemName: "plus.circle")
                    .hcbFont(.title2)
                Text("New List")
                    .hcbFont(.caption, weight: .medium)
            }
            .frame(width: 120, height: 80)
            .foregroundStyle(AppColor.ember)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(AppColor.ember.opacity(0.4), style: StrokeStyle(lineWidth: 1.2, dash: [4]))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Create a new Google Tasks list")
    }

    private func handleDrop(_ dropped: DraggedTask, on column: KanbanColumn) {
        guard let intent = column.dropIntent,
              let op = intent.operation(for: dropped.taskID) else { return }
        Task {
            let result = await model.performBulkTaskOperations([op])
            onResult(result)
        }
    }
}

private struct KanbanColumnView: View {
    @Environment(AppModel.self) private var model
    let column: KanbanColumn
    let mode: KanbanColumnMode
    let taskList: TaskListMirror?
    let isDropTargeted: Bool
    let onDrop: (DraggedTask) -> Void
    let onDropTargetChanged: (Bool) -> Void
    @Binding var selection: Set<TaskMirror.ID>
    let onCardTap: (TaskMirror) -> Void
    let onRenameList: (TaskListMirror) -> Void
    let onDeleteList: (TaskListMirror) -> Void
    let onClearCompleted: (TaskListMirror) -> Void
    let onCreateTask: () -> Void

    private let columnWidth: CGFloat = 260

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(column.tasks, id: \.id) { task in
                        KanbanCardView(
                            task: task,
                            isSelected: selection.contains(task.id),
                            onTap: { onCardTap(task) }
                        )
                        .draggable(DraggedTask(taskID: task.id, taskListID: task.taskListID, title: task.title))
                    }
                    // Inline add-task affordance — clicking anywhere in this
                    // zone opens QuickCreatePopover pre-filled with the
                    // column's list. Keeps the "click-to-create" feel from
                    // Apple Calendar's quick-create.
                    Button(action: onCreateTask) {
                        HStack(spacing: 6) {
                            Image(systemName: "plus.circle")
                            Text("Add task")
                        }
                        .hcbFont(.caption, weight: .medium)
                        .foregroundStyle(AppColor.ember.opacity(0.85))
                        .frame(maxWidth: .infinity)
                        .hcbScaledPadding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(AppColor.ember.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [3]))
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hcbScaledPadding(.horizontal, 2)
                    if column.tasks.isEmpty, column.dropIntent != nil {
                        Text("Drop here")
                            .hcbFont(.caption)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                }
                .hcbScaledPadding(.vertical, 4)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(width: columnWidth, alignment: .top)
        .hcbScaledPadding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(AppColor.cream.opacity(isDropTargeted ? 0.75 : 0.45))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(isDropTargeted ? AppColor.ember.opacity(0.6) : AppColor.cardStroke, lineWidth: isDropTargeted ? 1.4 : 0.6)
        )
        .dropDestination(for: DraggedTask.self) { items, _ in
            guard column.dropIntent != nil, let dropped = items.first else { return false }
            onDrop(dropped)
            return true
        } isTargeted: { targeted in
            guard column.dropIntent != nil else {
                onDropTargetChanged(false)
                return
            }
            onDropTargetChanged(targeted)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if mode == .byList {
                Circle()
                    .fill(AppColor.ember)
                    .hcbScaledFrame(width: 10, height: 10)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(column.title)
                    .hcbFont(.subheadline, weight: .semibold)
                    .foregroundStyle(AppColor.ink)
                    .lineLimit(1)
                if let subtitle = column.subtitle {
                    Text(subtitle)
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            if let list = taskList {
                Menu {
                    Button {
                        onRenameList(list)
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    Button {
                        onClearCompleted(list)
                    } label: {
                        Label("Clear Completed", systemImage: "eraser")
                    }
                    Divider()
                    Button(role: .destructive) {
                        onDeleteList(list)
                    } label: {
                        Label("Delete List", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .hcbFont(.caption, weight: .semibold)
                        .foregroundStyle(.secondary)
                        .frame(width: 22, height: 22)
                        .background(
                            Circle().fill(AppColor.cardStroke.opacity(0.25))
                        )
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct KanbanCardView: View {
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                        .hcbFont(.subheadline)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 4) {
                            Text(TagExtractor.stripped(from: task.title))
                                .hcbFont(.subheadline, weight: .medium)
                                .foregroundStyle(AppColor.ink)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        tagsRow
                        metaRow
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .hcbScaledPadding(10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.85))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(
                        isSelected ? AppColor.ember : AppColor.cardStroke,
                        lineWidth: isSelected ? 1.4 : 0.6
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var tags: [String] {
        TagExtractor.tags(in: task.title)
    }

    @ViewBuilder
    private var tagsRow: some View {
        if tags.isEmpty == false {
            HStack(spacing: 4) {
                ForEach(tags.prefix(4), id: \.self) { tag in
                    Text("#\(tag)")
                        .hcbFont(.caption2, weight: .medium)
                        .hcbScaledPadding(.horizontal, 6)
                        .hcbScaledPadding(.vertical, 1)
                        .background(Capsule().fill(AppColor.blue.opacity(0.15)))
                        .foregroundStyle(AppColor.blue)
                }
                if tags.count > 4 {
                    Text("+\(tags.count - 4)")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var metaRow: some View {
        HStack(spacing: 6) {
            if let due = task.dueDate {
                Label {
                    Text(dueDateBadge(due))
                } icon: {
                    Image(systemName: "calendar")
                }
                .hcbFont(.caption2)
                .foregroundStyle(dueDateColor(due))
            }
            let listName = model.taskLists.first(where: { $0.id == task.taskListID })?.title
            if let listName {
                Text(listName)
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    // Renders "Overdue", "Today", "Tomorrow", a weekday name, or a
    // month/day string. Replaces the old smart-filter badges with the
    // same information inline on the card — the filter menu is gone
    // post-refactor so users still need a quick-scan of "what's late".
    private func dueDateBadge(_ due: Date) -> String {
        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        let startOfDue = cal.startOfDay(for: due)
        let days = cal.dateComponents([.day], from: startOfToday, to: startOfDue).day ?? 0
        if days < 0 { return "Overdue \(-days)d" }
        if days == 0 { return "Today" }
        if days == 1 { return "Tomorrow" }
        if days < 7 { return due.formatted(.dateTime.weekday(.wide)) }
        return due.formatted(.dateTime.month(.abbreviated).day())
    }

    private func dueDateColor(_ due: Date) -> Color {
        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        let startOfDue = cal.startOfDay(for: due)
        if startOfDue < startOfToday { return AppColor.ember }
        if startOfDue == startOfToday { return AppColor.moss }
        return .secondary
    }
}
