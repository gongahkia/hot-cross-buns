import SwiftUI

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
                            Text.markdown(task.notes)
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
                        MarkdownEditor(text: $notes, placeholder: "Notes (markdown supported)", minHeight: 90, maxHeight: 200)
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
                    MarkdownEditor(text: $notes, placeholder: "Notes (markdown supported)", minHeight: 90, maxHeight: 200)
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

struct ManageTaskListsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var editor: TaskListEditor?
    @State private var taskListPendingDeletion: TaskListMirror?
    @State private var isMutating = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if model.taskLists.isEmpty {
                        ContentUnavailableView(
                            "No task lists loaded",
                            systemImage: "checklist",
                            description: Text("Connect Google and refresh before managing lists.")
                        )
                    } else {
                        ForEach(model.taskLists) { taskList in
                            TaskListManagementRow(
                                taskList: taskList,
                                taskCount: taskCount(for: taskList.id),
                                isSelected: model.isTaskListSelected(taskList.id),
                                rename: {
                                    editor = .rename(taskList)
                                },
                                delete: {
                                    taskListPendingDeletion = taskList
                                }
                            )
                            .disabled(isMutating)
                        }
                    }
                } footer: {
                    Text("Deleting a task list deletes the list and its tasks from Google Tasks. Some Google-owned default lists may not be deletable.")
                }
            }
            .navigationTitle("Task Lists")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                    .disabled(isMutating)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        editor = .create
                    } label: {
                        Label("New List", systemImage: "plus")
                    }
                    .disabled(model.account == nil || isMutating)
                }
            }
            .overlay {
                if isMutating {
                    ProgressView("Updating...")
                        .padding(18)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
            .sheet(item: $editor) { editor in
                TaskListEditorSheet(editor: editor)
            }
            .confirmationDialog(
                "Delete task list?",
                isPresented: deleteConfirmationBinding,
                titleVisibility: .visible
            ) {
                if let taskListPendingDeletion {
                    Button("Delete \(taskListPendingDeletion.title)", role: .destructive) {
                        Task {
                            await delete(taskListPendingDeletion)
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                if let taskListPendingDeletion {
                    Text("This deletes \"\(taskListPendingDeletion.title)\" and all tasks in it from Google Tasks.")
                }
            }
        }
        .interactiveDismissDisabled(isMutating)
    }

    private var deleteConfirmationBinding: Binding<Bool> {
        Binding(
            get: { taskListPendingDeletion != nil },
            set: { isPresented in
                if isPresented == false {
                    taskListPendingDeletion = nil
                }
            }
        )
    }

    private func taskCount(for taskListID: TaskListMirror.ID) -> Int {
        model.tasks.filter { $0.taskListID == taskListID && !$0.isDeleted }.count
    }

    private func delete(_ taskList: TaskListMirror) async {
        isMutating = true
        defer {
            isMutating = false
            taskListPendingDeletion = nil
        }
        _ = await model.deleteTaskList(taskList)
    }
}

private struct TaskListManagementRow: View {
    let taskList: TaskListMirror
    let taskCount: Int
    let isSelected: Bool
    let rename: () -> Void
    let delete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? AppColor.moss : .secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(taskList.title)
                    .font(.headline)
                Text("\(taskCount) active \(taskCount == 1 ? "task" : "tasks")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Menu {
                Button(action: rename) {
                    Label("Rename", systemImage: "pencil")
                }
                Button(role: .destructive, action: delete) {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
            }
            .menuStyle(.button)
        }
        .contentShape(Rectangle())
        .swipeActions {
            Button(role: .destructive, action: delete) {
                Label("Delete", systemImage: "trash")
            }
            Button(action: rename) {
                Label("Rename", systemImage: "pencil")
            }
            .tint(AppColor.blue)
        }
    }
}

private enum TaskListEditor: Identifiable, Hashable {
    case create
    case rename(TaskListMirror)

    var id: String {
        switch self {
        case .create:
            "create"
        case .rename(let taskList):
            "rename-\(taskList.id)"
        }
    }

    var navigationTitle: String {
        switch self {
        case .create:
            "New Task List"
        case .rename:
            "Rename Task List"
        }
    }

    var confirmationTitle: String {
        switch self {
        case .create:
            "Create"
        case .rename:
            "Save"
        }
    }

    var initialTitle: String {
        switch self {
        case .create:
            ""
        case .rename(let taskList):
            taskList.title
        }
    }
}

private struct TaskListEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let editor: TaskListEditor
    @State private var title: String
    @State private var isSaving = false

    init(editor: TaskListEditor) {
        self.editor = editor
        _title = State(initialValue: editor.initialTitle)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task list") {
                    TextField("Title", text: $title)
                }
            }
            .navigationTitle(editor.navigationTitle)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(editor.confirmationTitle) {
                        Task {
                            await save()
                        }
                    }
                    .disabled(canSave == false || isSaving)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var canSave: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false && model.account != nil
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }

        let didSave: Bool
        switch editor {
        case .create:
            didSave = await model.createTaskList(title: title)
        case .rename(let taskList):
            didSave = await model.updateTaskList(taskList, title: title)
        }

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

