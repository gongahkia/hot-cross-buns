import SwiftUI

struct TaskDrawerPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if undatedTasks.isEmpty {
                        ContentUnavailableView(
                            "No tasks to schedule",
                            systemImage: "tray",
                            description: Text("Tasks without a due date appear here.")
                        )
                        .padding(.top, 30)
                    } else {
                        ForEach(undatedTasks) { task in
                            row(task)
                        }
                    }
                }
            }
        }
        .padding(12)
        .frame(width: 260)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(AppColor.cream.opacity(0.35))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
        )
    }

    private var undatedTasks: [TaskMirror] {
        let selected: Set<TaskListMirror.ID> = model.settings.hasConfiguredTaskListSelection
            ? model.settings.selectedTaskListIDs
            : Set(model.taskLists.map(\.id))
        return model.tasks
            .filter { $0.isCompleted == false && $0.isDeleted == false && $0.dueDate == nil && selected.contains($0.taskListID) }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    private func row(_ task: TaskMirror) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "circle.dashed")
                .foregroundStyle(AppColor.ember)
            Text(task.title)
                .font(.subheadline)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .draggable(DraggedTask(taskID: task.id, taskListID: task.taskListID, title: task.title)) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down.forward.square")
                Text(task.title)
                    .lineLimit(1)
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Capsule().fill(AppColor.ember.opacity(0.3)))
        }
    }
}
