import SwiftUI

struct TasksView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

    var body: some View {
        List {
            ForEach(model.taskSections) { section in
                Section(section.taskList.title) {
                    if section.tasks.isEmpty {
                        Text("No tasks in this list")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(section.tasks) { task in
                            Button {
                                router.navigate(to: .task(task.id))
                            } label: {
                                TaskListRow(task: task)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .appBackground()
        .navigationTitle("Google Tasks")
        .toolbar {
            Button {
                router.present(.addTask)
            } label: {
                Label("Add Task", systemImage: "plus")
            }
        }
    }
}

struct TaskRowView: View {
    let task: TaskMirror
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            TaskListRow(task: task)
                .cardSurface(cornerRadius: 24)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.title)
    }
}

private struct TaskListRow: View {
    let task: TaskMirror

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? AppColor.moss : AppColor.ember)
                .font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text(task.title)
                    .font(.headline)
                    .foregroundStyle(AppColor.ink)
                if !task.notes.isEmpty {
                    Text(task.notes)
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
        .contentShape(Rectangle())
    }
}

struct TaskDetailView: View {
    @Environment(AppModel.self) private var model
    let taskID: TaskMirror.ID

    var body: some View {
        Group {
            if let task = model.task(id: taskID) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(task.title)
                            .font(.system(.largeTitle, design: .serif, weight: .bold))
                            .foregroundStyle(AppColor.ink)
                        if !task.notes.isEmpty {
                            Text(task.notes)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                        DetailField(label: "Status", value: task.status.rawValue)
                        if let dueDate = task.dueDate {
                            DetailField(label: "Due", value: dueDate.formatted(date: .abbreviated, time: .omitted))
                        }
                        DetailField(label: "Google ID", value: task.id)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
                .appBackground()
            } else {
                ContentUnavailableView("Task not found", systemImage: "checklist", description: Text("This task may have been deleted in Google Tasks."))
            }
        }
        .navigationTitle("Task")
    }
}

struct AddTaskSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Task creation is next",
                systemImage: "plus.circle",
                description: Text("This shell is ready for a Google Tasks insert flow once OAuth is configured.")
            )
            .navigationTitle("New Task")
            .toolbar {
                Button("Close") {
                    dismiss()
                }
            }
        }
    }
}

struct DetailField: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.body.monospaced())
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(cornerRadius: 22)
    }
}

#Preview {
    NavigationStack {
        TasksView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
