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
                            .swipeActions(edge: .leading) {
                                Button {
                                    Task {
                                        await model.setTaskCompleted(!task.isCompleted, task: task)
                                    }
                                } label: {
                                    Label(task.isCompleted ? "Reopen" : "Complete", systemImage: task.isCompleted ? "arrow.uturn.backward.circle" : "checkmark.circle")
                                }
                                .tint(task.isCompleted ? AppColor.blue : AppColor.moss)
                            }
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
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let taskID: TaskMirror.ID
    @State private var isEditing = false
    @State private var isMutating = false
    @State private var isConfirmingDelete = false

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
                        TaskActionPanel(
                            task: task,
                            isMutating: isMutating,
                            onToggleCompletion: {
                                Task {
                                    await setCompletion(for: task)
                                }
                            },
                            onEdit: {
                                isEditing = true
                            },
                            onDelete: {
                                isConfirmingDelete = true
                            }
                        )
                        DetailField(label: "Google ID", value: task.id)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
                .appBackground()
                .sheet(isPresented: $isEditing) {
                    EditTaskSheet(task: task)
                }
                .confirmationDialog(
                    "Delete this task?",
                    isPresented: $isConfirmingDelete,
                    titleVisibility: .visible
                ) {
                    Button("Delete Task", role: .destructive) {
                        Task {
                            await delete(task)
                        }
                    }

                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This deletes the task from Google Tasks.")
                }
            } else {
                ContentUnavailableView("Task not found", systemImage: "checklist", description: Text("This task may have been deleted in Google Tasks."))
            }
        }
        .navigationTitle("Task")
    }

    private func setCompletion(for task: TaskMirror) async {
        isMutating = true
        defer { isMutating = false }
        _ = await model.setTaskCompleted(!task.isCompleted, task: task)
    }

    private func delete(_ task: TaskMirror) async {
        isMutating = true
        defer { isMutating = false }
        let didDelete = await model.deleteTask(task)
        if didDelete {
            dismiss()
        }
    }
}

private struct TaskActionPanel: View {
    let task: TaskMirror
    let isMutating: Bool
    let onToggleCompletion: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button(action: onToggleCompletion) {
                Label(
                    task.isCompleted ? "Mark Needs Action" : "Mark Complete",
                    systemImage: task.isCompleted ? "arrow.uturn.backward.circle" : "checkmark.circle.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(task.isCompleted ? AppColor.blue : AppColor.moss)

            Button(action: onEdit) {
                Label("Edit Details", systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button(role: .destructive, action: onDelete) {
                Label("Delete Task", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .disabled(isMutating)
        .cardSurface(cornerRadius: 22)
    }
}

struct AddTaskSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var selectedTaskListID: TaskListMirror.ID?
    @State private var title = ""
    @State private var notes = ""
    @State private var hasDueDate = false
    @State private var dueDate = Date()
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                if model.taskLists.isEmpty {
                    Section {
                        ContentUnavailableView(
                            "No task lists loaded",
                            systemImage: "checklist",
                            description: Text("Connect Google and refresh before creating a task.")
                        )
                    }
                } else {
                    Section("Task") {
                        TextField("Title", text: $title)
                        TextField("Notes", text: $notes, axis: .vertical)
                            .lineLimit(3...6)
                    }

                    Section("Destination") {
                        Picker("Task list", selection: $selectedTaskListID) {
                            ForEach(model.taskLists) { taskList in
                                Text(taskList.title).tag(Optional(taskList.id))
                            }
                        }
                    }

                    Section("Due date") {
                        Toggle("Set due date", isOn: $hasDueDate)
                        if hasDueDate {
                            DatePicker("Due", selection: $dueDate, displayedComponents: [.date])
                        }
                    }
                }
            }
            .navigationTitle("New Task")
            .task {
                selectedTaskListID = selectedTaskListID ?? model.taskLists.first?.id
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await createTask()
                        }
                    }
                    .disabled(canCreate == false || isSaving)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var canCreate: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && selectedTaskListID != nil
            && model.account != nil
    }

    private func createTask() async {
        guard let selectedTaskListID else {
            return
        }

        isSaving = true
        defer { isSaving = false }

        let didCreate = await model.createTask(
            title: title,
            notes: notes,
            dueDate: hasDueDate ? Calendar.current.startOfDay(for: dueDate) : nil,
            taskListID: selectedTaskListID
        )

        if didCreate {
            dismiss()
        }
    }
}

struct EditTaskSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    @State private var title: String
    @State private var notes: String
    @State private var hasDueDate: Bool
    @State private var dueDate: Date
    @State private var isSaving = false

    init(task: TaskMirror) {
        self.task = task
        _title = State(initialValue: task.title)
        _notes = State(initialValue: task.notes)
        _hasDueDate = State(initialValue: task.dueDate != nil)
        _dueDate = State(initialValue: task.dueDate ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Title", text: $title)
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Due date") {
                    Toggle("Set due date", isOn: $hasDueDate)
                    if hasDueDate {
                        DatePicker("Due", selection: $dueDate, displayedComponents: [.date])
                    }
                }
            }
            .navigationTitle("Edit Task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await saveTask()
                        }
                    }
                    .disabled(canSave == false || isSaving)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var canSave: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && model.account != nil
    }

    private func saveTask() async {
        isSaving = true
        defer { isSaving = false }

        let didSave = await model.updateTask(
            task,
            title: title,
            notes: notes,
            dueDate: hasDueDate ? Calendar.current.startOfDay(for: dueDate) : nil
        )

        if didSave {
            dismiss()
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
