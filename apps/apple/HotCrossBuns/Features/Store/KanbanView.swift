import SwiftUI

// Kanban board host. Renders one scrollable column per KanbanColumn; each
// card is a DraggedTask that routes back to AppModel.performBulkTaskOperations
// via the column's KanbanDropIntent.
//
// Data-safety notes:
//  - Drop-to-same-column is a no-op: the column's intent maps to a
//    BulkTaskOperation the optimizer will drop as already-in-state.
//  - Invalid drops (no dropIntent) fail closed — the column simply won't
//    accept the drag. No silent mutation.
//  - Every drop still routes through the optimistic-write helpers, so offline
//    queue + etag conflict + undo paths apply unchanged.
struct KanbanView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    let tasks: [TaskMirror]
    @Binding var columnMode: KanbanColumnMode
    @Binding var selection: Set<TaskMirror.ID>
    var onResult: (BulkTaskExecutionResult) -> Void = { _ in }

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
                            isDropTargeted: dropHighlightColumnID == column.id,
                            onDrop: { dropped in handleDrop(dropped, on: column) },
                            onDropTargetChanged: { isTargeted in
                                dropHighlightColumnID = isTargeted ? column.id : nil
                            },
                            selection: $selection,
                            onCardTap: openTask
                        )
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

    private var header: some View {
        HStack(spacing: 10) {
            Text("Group by")
                .hcbFont(.caption, weight: .semibold)
                .foregroundStyle(.secondary)
            Picker("Group", selection: $columnMode) {
                ForEach(KanbanColumnMode.allCases, id: \.self) { m in
                    Label(m.title, systemImage: m.systemImage).tag(m)
                }
            }
            .pickerStyle(.segmented)
            .fixedSize()
            Spacer(minLength: 0)
            Text("\(tasks.count) task\(tasks.count == 1 ? "" : "s")")
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 10)
    }

    private func handleDrop(_ dropped: DraggedTask, on column: KanbanColumn) {
        guard let intent = column.dropIntent,
              let op = intent.operation(for: dropped.taskID) else { return }
        Task {
            let result = await model.performBulkTaskOperations([op])
            onResult(result)
        }
    }

    private func openTask(_ task: TaskMirror) {
        // Route through the inspector path the list view uses — keeps detail
        // editing consistent between List and Kanban modes.
        selection = [task.id]
    }
}

private struct KanbanColumnView: View {
    @Environment(AppModel.self) private var model
    let column: KanbanColumn
    let isDropTargeted: Bool
    let onDrop: (DraggedTask) -> Void
    let onDropTargetChanged: (Bool) -> Void
    @Binding var selection: Set<TaskMirror.ID>
    let onCardTap: (TaskMirror) -> Void

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
                    if column.tasks.isEmpty {
                        Text(column.dropIntent == nil ? "" : "Drop here")
                            .hcbFont(.caption)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(AppColor.cardStroke.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4]))
                            )
                            .hcbScaledPadding(.horizontal, 4)
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
            // Only highlight columns that can actually receive the drop —
            // silently-unhighlighted columns tell the user "I'm not a target"
            // without needing a separate disabled affordance.
            guard column.dropIntent != nil else {
                onDropTargetChanged(false)
                return
            }
            onDropTargetChanged(targeted)
        }
    }

    private var header: some View {
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
                            if TaskStarring.isStarred(task) {
                                Image(systemName: "star.fill")
                                    .hcbFont(.caption2)
                                    .foregroundStyle(.yellow)
                            }
                            Text(TagExtractor.stripped(from: TaskStarring.displayTitle(for: task)))
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
                    Text(due.formatted(.dateTime.month(.abbreviated).day()))
                } icon: {
                    Image(systemName: "calendar")
                }
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
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
}
