import SwiftUI

struct QuickAddView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    @State private var input: String = ""
    @State private var parsed: ParsedQuickAddTask = ParsedQuickAddTask(title: "", dueDate: nil, taskListHint: nil, matchedTokens: [])
    @State private var selectedTaskListID: TaskListMirror.ID?
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            TextField("Add a task — try \"email rent receipt tmr #personal\"", text: $input, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(.title3, design: .rounded, weight: .medium))
                .lineLimit(1...4)
                .focused($focusedField)
                .onSubmit { Task { await submit() } }
                .onChange(of: input) { _, newValue in reparse(newValue) }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(AppColor.cream.opacity(0.8))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(AppColor.cardStroke, lineWidth: 0.8)
                )

            previewStrip

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(AppColor.ember)
            }

            HStack {
                listPicker
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    Task { await submit() }
                } label: {
                    if isSubmitting {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Add Task")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.ember)
                .keyboardShortcut(.return, modifiers: [])
                .disabled(canSubmit == false)
            }
        }
        .padding(22)
        .frame(width: 560)
        .onAppear {
            focusedField = true
            selectedTaskListID = selectedTaskListID ?? defaultListID
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(AppColor.ember)
            Text("Quick Add")
                .font(.headline)
            Spacer(minLength: 0)
            Text("Return to add, Esc to cancel")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var previewStrip: some View {
        HStack(spacing: 8) {
            if parsed.title.isEmpty {
                Label("Type a title", systemImage: "text.cursor")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                chip(icon: "text.alignleft", text: parsed.title, tint: AppColor.ink)
            }
            if let due = parsed.dueDate {
                chip(icon: "calendar", text: tokenDisplay(.dueDate) ?? due.formatted(date: .abbreviated, time: .omitted), tint: AppColor.moss)
            }
            if parsed.taskListHint != nil {
                chip(icon: "number", text: resolvedListName, tint: AppColor.blue)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 26)
    }

    private var listPicker: some View {
        Picker("List", selection: Binding(
            get: { selectedTaskListID ?? defaultListID },
            set: { selectedTaskListID = $0 }
        )) {
            ForEach(model.taskLists) { list in
                Text(list.title).tag(Optional(list.id))
            }
        }
        .pickerStyle(.menu)
        .fixedSize()
        .labelsHidden()
    }

    private func chip(icon: String, text: String, tint: Color) -> some View {
        Label {
            Text(text).lineLimit(1)
        } icon: {
            Image(systemName: icon)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule().fill(tint.opacity(0.15))
        )
        .foregroundStyle(tint)
    }

    private var canSubmit: Bool {
        parsed.title.isEmpty == false && (selectedTaskListID ?? defaultListID) != nil && model.account != nil && isSubmitting == false
    }

    private var defaultListID: TaskListMirror.ID? {
        if let hint = parsed.taskListHint {
            if let match = model.taskLists.first(where: { $0.title.localizedCaseInsensitiveCompare(hint) == .orderedSame }) {
                return match.id
            }
            if let match = model.taskLists.first(where: { $0.title.localizedCaseInsensitiveContains(hint) }) {
                return match.id
            }
        }
        return model.taskLists.first?.id
    }

    private var resolvedListName: String {
        if let id = selectedTaskListID ?? defaultListID,
           let list = model.taskLists.first(where: { $0.id == id }) {
            return list.title
        }
        return parsed.taskListHint ?? ""
    }

    private func tokenDisplay(_ kind: ParsedQuickAddTask.MatchedToken.Kind) -> String? {
        parsed.matchedTokens.first(where: { $0.kind == kind })?.display
    }

    private func reparse(_ text: String) {
        let parser = NaturalLanguageTaskParser()
        parsed = parser.parse(text)
        if selectedTaskListID == nil, let hintID = defaultListID {
            selectedTaskListID = hintID
        }
    }

    private func submit() async {
        guard canSubmit else { return }
        guard let listID = selectedTaskListID ?? defaultListID else { return }
        isSubmitting = true
        errorMessage = nil
        let didCreate = await model.createTask(
            title: parsed.title,
            notes: "",
            dueDate: parsed.dueDate,
            taskListID: listID
        )
        isSubmitting = false
        if didCreate {
            dismiss()
        } else {
            errorMessage = model.lastMutationError ?? "Couldn't add task."
        }
    }
}
