import AppKit
import SwiftUI

struct TaskDraft: Equatable {
    var title: String
    var notes: String
    var hasDueDate: Bool
    var dueDate: Date

    init(task: TaskMirror, fallbackDueDate: Date = Date()) {
        self.title = task.title
        self.notes = task.notes
        self.hasDueDate = task.dueDate != nil
        self.dueDate = task.dueDate ?? fallbackDueDate
    }

    func differs(from task: TaskMirror) -> Bool {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedTitle != task.title { return true }
        if trimmedNotes != task.notes { return true }
        let currentDue = task.dueDate
        if hasDueDate == false && currentDue != nil { return true }
        if hasDueDate && currentDue == nil { return true }
        if hasDueDate, let currentDue {
            let calendar = Calendar.current
            if calendar.startOfDay(for: dueDate) != calendar.startOfDay(for: currentDue) { return true }
        }
        return false
    }

    func resolvedDueDate() -> Date? {
        guard hasDueDate else { return nil }
        return Calendar.current.startOfDay(for: dueDate)
    }

    var hasUsableTitle: Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }
}

struct TaskInspectorView: View {
    @Environment(AppModel.self) private var model
    let task: TaskMirror
    let close: () -> Void

    @State private var draft: TaskDraft
    @State private var saveTask: Task<Void, Never>?
    @State private var isConfirmingDelete = false
    @State private var isSavingNow = false
    @State private var savedAt: Date?
    @State private var saveFailureMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case title, notes }

    init(task: TaskMirror, close: @escaping () -> Void) {
        self.task = task
        self.close = close
        _draft = State(initialValue: TaskDraft(task: task))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                TextField("Task title", text: $draft.title, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(.title2, design: .serif, weight: .semibold))
                    .foregroundStyle(AppColor.ink)
                    .focused($focusedField, equals: .title)
                    .onChange(of: draft.title) { _, _ in scheduleSave() }

                VStack(alignment: .leading, spacing: 6) {
                    sectionLabel("NOTES")
                    MarkdownEditor(text: $draft.notes, placeholder: "Notes (markdown supported)", minHeight: 120, maxHeight: 240)
                        .onChange(of: draft.notes) { _, _ in scheduleSave() }
                }

                dueDateSection

                recurrenceSection

                remindersSection

                dependenciesSection

                taskListSection

                subtasksSection

                hierarchyControls

                actionButtons

                inlineErrorBanner

                metadataSection
            }
            .hcbScaledPadding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(AppColor.cream.opacity(0.35))
        .navigationTitle("Task")
        .onChange(of: task.id) { _, _ in
            commitPending()
            draft = TaskDraft(task: task)
            savedAt = nil
        }
        .onChange(of: task.title) { _, _ in refreshDraftIfClean() }
        .onChange(of: task.notes) { _, _ in refreshDraftIfClean() }
        .onChange(of: task.dueDate) { _, _ in refreshDraftIfClean() }
        .onDisappear { commitPending() }
        .background(
            Button("Save and Close") {
                commitPending()
                close()
            }
            .keyboardShortcut(.return, modifiers: [.command, .shift])
            .opacity(0)
            .hcbScaledFrame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        )
        .confirmationDialog(
            "Delete this task?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { await delete() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes the task from Google Tasks. It cannot be undone.")
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            statusDot
            Text(statusLabel)
                .hcbFont(.caption, weight: .semibold)
                .foregroundStyle(.secondary)
            starButton
            Spacer(minLength: 0)
            if isSavingNow {
                ProgressView().controlSize(.small)
            } else if let savedAt {
                Text("Saved \(savedAt.formatted(.relative(presentation: .numeric)))")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button {
                commitPending()
                close()
            } label: {
                Image(systemName: "xmark")
                    .hcbFontSystem(size: 11, weight: .semibold)
                    .hcbScaledPadding(6)
                    .background(Circle().fill(AppColor.cream))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel("Close task")
        }
    }

    private var statusDot: some View {
        Circle()
            .fill(task.isCompleted ? AppColor.moss : AppColor.ember)
            .hcbScaledFrame(width: 10, height: 10)
    }

    private var starButton: some View {
        Button {
            Task { _ = await model.toggleTaskStar(task) }
        } label: {
            Image(systemName: TaskStarring.isStarred(task) ? "star.fill" : "star")
                .foregroundStyle(TaskStarring.isStarred(task) ? .yellow : .secondary)
        }
        .buttonStyle(.plain)
        .help(TaskStarring.isStarred(task) ? "Remove star" : "Star as important")
        .accessibilityLabel(TaskStarring.isStarred(task) ? "Unstar task" : "Star task")
    }

    private var statusLabel: String {
        if task.isCompleted {
            if let completedAt = task.completedAt {
                return "Completed \(completedAt.formatted(date: .abbreviated, time: .omitted))"
            }
            return "Completed"
        }
        if let due = task.dueDate {
            let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: Calendar.current.startOfDay(for: due)).day ?? 0
            if days < 0 { return "Overdue by \(-days) day\(days == -1 ? "" : "s")" }
            if days == 0 { return "Due today" }
            if days == 1 { return "Due tomorrow" }
            return "Due in \(days) days"
        }
        return "No due date"
    }

    private var dueDateSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("DUE DATE")
            Toggle(isOn: $draft.hasDueDate) {
                Text(draft.hasDueDate ? draft.dueDate.formatted(date: .complete, time: .omitted) : "No due date")
                    .hcbFont(.subheadline)
            }
            .toggleStyle(.switch)
            .onChange(of: draft.hasDueDate) { _, _ in scheduleSave() }

            if draft.hasDueDate {
                DatePicker("", selection: $draft.dueDate, displayedComponents: [.date])
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                    .onChange(of: draft.dueDate) { _, _ in scheduleSave() }
            }

            Text("Google Tasks stores dates only; reminder times must be set as calendar events.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
    }

    @State private var pendingMoveListID: TaskListMirror.ID?

    private var taskListSection: some View {
        HStack(spacing: 10) {
            Image(systemName: "list.bullet")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("LIST")
                    .hcbFont(.caption2, weight: .bold)
                    .foregroundStyle(.secondary)
                Picker("Task list", selection: Binding(
                    get: { task.taskListID },
                    set: { newID in
                        if newID != task.taskListID { pendingMoveListID = newID }
                    }
                )) {
                    ForEach(model.taskLists) { list in
                        Text(list.title).tag(list.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
            }
            Spacer(minLength: 0)
        }
        .hcbScaledPadding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .confirmationDialog(
            "Move task to another list?",
            isPresented: Binding(
                get: { pendingMoveListID != nil },
                set: { if $0 == false { pendingMoveListID = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let newID = pendingMoveListID,
               let target = model.taskLists.first(where: { $0.id == newID }) {
                Button("Move to \(target.title)") {
                    Task {
                        _ = await model.moveTaskToList(task, toTaskListID: newID)
                        pendingMoveListID = nil
                    }
                }
            }
            Button("Cancel", role: .cancel) { pendingMoveListID = nil }
        } message: {
            Text("Google Tasks doesn't support moving between lists natively. The task will be recreated in the new list and the old copy deleted. Its Google ID will change.")
        }
    }

    private var currentListTitle: String {
        model.taskLists.first(where: { $0.id == task.taskListID })?.title ?? "Unknown list"
    }

    private var actionButtons: some View {
        VStack(spacing: 8) {
            Button {
                Task { await toggleCompletion() }
            } label: {
                Label(
                    task.isCompleted ? "Mark as Needs Action" : "Mark Complete",
                    systemImage: task.isCompleted ? "arrow.uturn.backward.circle" : "checkmark.circle.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(task.isCompleted ? AppColor.blue : AppColor.moss)
            .keyboardShortcut(.return, modifiers: [.command])

            Button(role: .destructive) {
                isConfirmingDelete = true
            } label: {
                Label("Delete Task", systemImage: "trash")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .keyboardShortcut(.delete, modifiers: [.command])

            Button {
                Task { _ = await model.duplicateTask(task) }
            } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .keyboardShortcut("d", modifiers: [.command])

            Button {
                copyAsMarkdown()
            } label: {
                Label("Copy as Markdown", systemImage: "doc.on.clipboard")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .disabled(model.isMutating)
    }

    private func copyAsMarkdown() {
        let listTitle = model.taskLists.first(where: { $0.id == task.taskListID })?.title
        let markdown = TaskMarkdownExporter.markdown(for: task, taskListTitle: listTitle)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(markdown, forType: .string)
    }

    private var children: [TaskMirror] {
        TaskHierarchy.sortByPosition(
            model.tasks.filter { $0.parentID == task.id && $0.isDeleted == false }
        )
    }

    private var isSubtask: Bool { task.parentID != nil }

    @State private var newSubtaskTitle: String = ""
    @State private var isAddingSubtask: Bool = false

    @ViewBuilder
    private var subtasksSection: some View {
        if isSubtask {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                sectionLabel("SUBTASKS")
                ForEach(Array(children.enumerated()), id: \.element.id) { index, child in
                    HStack(spacing: 10) {
                        Image(systemName: "line.3.horizontal")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                            .help("Drag to reorder")
                        Button {
                            Task { await model.setTaskCompleted(!child.isCompleted, task: child) }
                        } label: {
                            Image(systemName: child.isCompleted ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(child.isCompleted ? AppColor.moss : AppColor.ember)
                        }
                        .buttonStyle(.plain)
                        Text(child.title)
                            .hcbFont(.subheadline)
                            .strikethrough(child.isCompleted, color: .secondary)
                            .foregroundStyle(child.isCompleted ? .secondary : AppColor.ink)
                        Spacer(minLength: 0)
                        Button(role: .destructive) {
                            Task { await model.deleteTask(child) }
                        } label: {
                            Image(systemName: "xmark.circle")
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .hcbScaledPadding(.vertical, 2)
                    .contentShape(Rectangle())
                    .draggable(SubtaskDragPayload(taskID: child.id))
                    .dropDestination(for: SubtaskDragPayload.self) { items, _ in
                        guard let drop = items.first, drop.taskID != child.id else { return false }
                        Task { await handleSubtaskDrop(draggedID: drop.taskID, targetIndex: index) }
                        return true
                    }
                }

                HStack(spacing: 8) {
                    Image(systemName: "plus.circle")
                        .foregroundStyle(AppColor.ember)
                    TextField("Add a subtask", text: $newSubtaskTitle)
                        .textFieldStyle(.plain)
                        .onSubmit { Task { await addSubtask() } }
                    if isAddingSubtask { ProgressView().controlSize(.small) }
                }
                .hcbScaledPadding(10)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(AppColor.cream.opacity(0.5))
                )
            }
            .hcbScaledPadding(14)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
        }
    }

    @ViewBuilder
    private var hierarchyControls: some View {
        HStack(spacing: 8) {
            if TaskHierarchy.canIndent(task, within: model.tasks) {
                Button {
                    Task { await model.indentTask(task) }
                } label: {
                    Label("Indent", systemImage: "increase.indent")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.tab, modifiers: [])
            }
            if TaskHierarchy.canOutdent(task) {
                Button {
                    Task { await model.outdentTask(task) }
                } label: {
                    Label("Outdent", systemImage: "decrease.indent")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.tab, modifiers: [.shift])
            }
        }
        .disabled(model.isMutating)
    }

    private func addSubtask() async {
        let trimmed = newSubtaskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        isAddingSubtask = true
        let created = await model.createTask(
            title: trimmed,
            notes: "",
            dueDate: nil,
            taskListID: task.taskListID,
            parentID: task.id
        )
        isAddingSubtask = false
        if created { newSubtaskTitle = "" }
    }

    @ViewBuilder
    private var recurrenceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("REPEAT")
            RecurrenceEditor(rule: recurrenceBinding)
            Text(task.dueDate == nil
                 ? "Add a due date to enable repeating."
                 : "When you complete this task, a new copy is created for the next occurrence.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
        .hcbScaledPadding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .disabled(task.dueDate == nil)
    }

    private var recurrenceBinding: Binding<RecurrenceRule?> {
        Binding(
            get: { TaskRecurrenceMarkers.rule(from: task.notes) },
            set: { newRule in
                let newNotes = TaskRecurrenceMarkers.encode(notes: task.notes, rule: newRule)
                Task {
                    _ = await model.updateTask(
                        task,
                        title: task.title,
                        notes: newNotes,
                        dueDate: task.dueDate
                    )
                }
            }
        )
    }

    @ViewBuilder
    private var remindersSection: some View {
        let current = TaskReminderMarkers.offsetsInDays(from: task.notes)
        let presets: [(offset: Int, label: String)] = [
            (0, "On due date"),
            (-1, "1 day before"),
            (-2, "2 days before"),
            (-7, "1 week before")
        ]
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("REMINDERS")
            Text("Local only. Fires at 9:00 AM on the chosen day.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
            ForEach(presets, id: \.offset) { preset in
                Toggle(isOn: reminderBinding(offset: preset.offset, current: current)) {
                    Text(preset.label).hcbFont(.subheadline)
                }
                .toggleStyle(.switch)
            }
        }
        .hcbScaledPadding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
    }

    private func reminderBinding(offset: Int, current: [Int]) -> Binding<Bool> {
        Binding(
            get: { current.contains(offset) },
            set: { newValue in
                var updated = Set(current)
                if newValue { updated.insert(offset) } else { updated.remove(offset) }
                let newNotes = TaskReminderMarkers.encode(
                    notes: task.notes,
                    offsetsInDays: Array(updated)
                )
                Task {
                    _ = await model.updateTask(
                        task,
                        title: task.title,
                        notes: newNotes,
                        dueDate: task.dueDate
                    )
                }
            }
        )
    }

    @ViewBuilder
    private var dependenciesSection: some View {
        let blockerIDs = TaskDependencyMarkers.blockerIDs(from: task.notes)
        let blockers = blockerIDs.compactMap { id in model.tasks.first(where: { $0.id == id }) }
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("BLOCKED BY")
            if blockers.isEmpty {
                Text("Not blocked by anything.")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(blockers, id: \.id) { blocker in
                    HStack(spacing: 8) {
                        Image(systemName: blocker.isCompleted ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(blocker.isCompleted ? AppColor.moss : AppColor.ember)
                        Text(blocker.title)
                            .hcbFont(.subheadline)
                            .strikethrough(blocker.isCompleted)
                        Spacer(minLength: 0)
                        Button {
                            removeBlocker(blocker.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(blocker.title) from blockers")
                    }
                }
            }
            Menu("Add blocker…") {
                let candidates = model.tasks
                    .filter { $0.id != task.id && $0.isDeleted == false && blockerIDs.contains($0.id) == false }
                    .prefix(20)
                if candidates.isEmpty {
                    Text("No other tasks available")
                } else {
                    ForEach(candidates, id: \.id) { candidate in
                        Button(candidate.title) { addBlocker(candidate.id) }
                    }
                }
            }
            .hcbFont(.caption)
        }
        .hcbScaledPadding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
    }

    private func handleSubtaskDrop(draggedID: TaskMirror.ID, targetIndex: Int) async {
        let ordered = children
        guard let draggedTask = ordered.first(where: { $0.id == draggedID }) else { return }
        guard let fromIndex = ordered.firstIndex(where: { $0.id == draggedID }) else { return }
        if fromIndex == targetIndex { return }
        // Google's move API expects the "previous sibling" ID. When the target
        // is above the dragged row's original spot, the previous sibling is the
        // row at targetIndex - 1 (or nil when dropping to the top).
        let adjustedPreviousID: TaskMirror.ID? = {
            let insertionIndex = targetIndex
            guard insertionIndex > 0 else { return nil }
            let predecessorIndex = insertionIndex - 1
            let predecessor = ordered[predecessorIndex]
            if predecessor.id == draggedTask.id {
                // Shouldn't happen (we guard above), but keep safe
                return predecessorIndex > 0 ? ordered[predecessorIndex - 1].id : nil
            }
            return predecessor.id
        }()
        _ = await model.reorderTask(draggedTask, afterSiblingID: adjustedPreviousID)
    }

    private func addBlocker(_ id: String) {
        var ids = TaskDependencyMarkers.blockerIDs(from: task.notes)
        guard ids.contains(id) == false else { return }
        ids.append(id)
        let newNotes = TaskDependencyMarkers.encode(notes: task.notes, blockerIDs: ids)
        Task {
            _ = await model.updateTask(task, title: task.title, notes: newNotes, dueDate: task.dueDate)
        }
    }

    private func removeBlocker(_ id: String) {
        var ids = TaskDependencyMarkers.blockerIDs(from: task.notes)
        ids.removeAll { $0 == id }
        let newNotes = TaskDependencyMarkers.encode(notes: task.notes, blockerIDs: ids)
        Task {
            _ = await model.updateTask(task, title: task.title, notes: newNotes, dueDate: task.dueDate)
        }
    }

    @ViewBuilder
    private var inlineErrorBanner: some View {
        if let saveFailureMessage {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(AppColor.ember)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Couldn't save")
                        .hcbFont(.caption, weight: .semibold)
                    Text(saveFailureMessage)
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button {
                    self.saveFailureMessage = nil
                    Task { await saveIfDirty() }
                } label: {
                    Text("Retry")
                        .hcbFont(.caption, weight: .semibold)
                }
                .buttonStyle(.bordered)
            }
            .hcbScaledPadding(12)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(AppColor.ember.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(AppColor.ember.opacity(0.4), lineWidth: 0.8)
            )
        }
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("GOOGLE ID")
            Text(task.id)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .foregroundStyle(.secondary)
            if let updated = task.updatedAt {
                Text("Updated \(updated.formatted(date: .abbreviated, time: .shortened))")
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .hcbScaledPadding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var notesForPreview: String {
        let withoutReminders = TaskReminderMarkers.strippedNotes(from: draft.notes)
        return TaskRecurrenceMarkers.strippedNotes(from: withoutReminders)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .hcbFont(.caption2, weight: .bold)
            .foregroundStyle(.secondary)
    }

    private func scheduleSave() {
        saveTask?.cancel()
        guard draft.hasUsableTitle else { return }
        saveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(600))
            guard Task.isCancelled == false else { return }
            await saveIfDirty()
        }
    }

    private func commitPending() {
        // Cancel the debounce. We must fire-and-forget here because
        // .onDisappear is synchronous — but thanks to the reference-
        // counted mutationCount in AppModel, an overlapping save from
        // this detached Task no longer races with a concurrent mutation
        // elsewhere to prematurely clear isMutating. saveIfDirty itself
        // checks `draft.differs` / `hasUsableTitle` before hitting the
        // network, so late-arriving drafts don't re-submit a stale one.
        saveTask?.cancel()
        saveTask = nil
        guard draft.differs(from: task), draft.hasUsableTitle else { return }
        let snapshot = draft
        let targetTask = task
        Task { @MainActor in
            _ = await model.updateTask(
                targetTask,
                title: snapshot.title,
                notes: snapshot.notes,
                dueDate: snapshot.resolvedDueDate()
            )
        }
    }

    private func refreshDraftIfClean() {
        guard draft.differs(from: task) == false else { return }
        draft = TaskDraft(task: task)
    }

    private func saveIfDirty() async {
        guard draft.differs(from: task) else { return }
        guard draft.hasUsableTitle else { return }
        isSavingNow = true
        let existingBlockers = TaskDependencyMarkers.blockerIDs(from: task.notes)
        let editedNotes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let notesWithBlockers = existingBlockers.isEmpty
            ? editedNotes
            : TaskDependencyMarkers.encode(notes: editedNotes, blockerIDs: existingBlockers)
        let didSave = await model.updateTask(
            task,
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: notesWithBlockers,
            dueDate: draft.resolvedDueDate()
        )
        isSavingNow = false
        if didSave {
            savedAt = Date()
            saveFailureMessage = nil
        } else {
            saveFailureMessage = model.lastMutationError ?? "Save failed."
        }
    }

    private func toggleCompletion() async {
        commitPending()
        _ = await model.setTaskCompleted(!task.isCompleted, task: task)
    }

    private func delete() async {
        saveTask?.cancel()
        let didDelete = await model.deleteTask(task)
        if didDelete { close() }
    }
}

struct TaskInspectorEmptyState: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "text.magnifyingglass")
                .hcbFontSystem(size: 36)
                .foregroundStyle(.tertiary)
            Text("Select a task")
                .hcbFont(.headline)
            Text("Pick a task from the list to view and edit its details.")
                .hcbFont(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .hcbScaledPadding(.horizontal, 30)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppColor.cream.opacity(0.25))
        .navigationTitle("Task")
    }
}
