import SwiftUI

struct CustomFiltersSection: View {
    @Environment(AppModel.self) private var model
    @State private var editor: CustomFilterDefinition?
    @State private var isCreating = false

    var body: some View {
        Section("Custom Filters") {
            if model.settings.customFilters.isEmpty {
                Text("No custom filters yet. Save any combination of due-window, list, and star criteria as a reusable sidebar entry.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.settings.customFilters) { filter in
                    Button {
                        editor = filter
                    } label: {
                        HStack {
                            Label(filter.name, systemImage: filter.systemImage)
                            Spacer()
                            Text(summary(filter))
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            model.deleteCustomFilter(filter.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }

            Button {
                isCreating = true
            } label: {
                Label("New Filter", systemImage: "plus")
            }
        }
        .sheet(isPresented: $isCreating) {
            CustomFilterEditor(draft: CustomFilterDefinition(name: "New Filter"), onSave: { filter in
                model.upsertCustomFilter(filter)
                isCreating = false
            }, onCancel: { isCreating = false })
        }
        .sheet(item: $editor) { filter in
            CustomFilterEditor(draft: filter, onSave: { updated in
                model.upsertCustomFilter(updated)
                editor = nil
            }, onCancel: { editor = nil })
        }
    }

    private func summary(_ filter: CustomFilterDefinition) -> String {
        var parts: [String] = [filter.dueWindow.title]
        if filter.starredOnly { parts.append("starred") }
        if filter.includeCompleted { parts.append("+ completed") }
        if filter.taskListIDs.isEmpty == false { parts.append("\(filter.taskListIDs.count) lists") }
        if filter.tagsAny.isEmpty == false { parts.append(filter.tagsAny.map { "#\($0)" }.joined(separator: " ")) }
        return parts.joined(separator: " · ")
    }
}

private struct CustomFilterEditor: View {
    @Environment(AppModel.self) private var model
    @State var draft: CustomFilterDefinition
    @State private var tagsText: String
    let onSave: (CustomFilterDefinition) -> Void
    let onCancel: () -> Void

    init(draft: CustomFilterDefinition, onSave: @escaping (CustomFilterDefinition) -> Void, onCancel: @escaping () -> Void) {
        _draft = State(initialValue: draft)
        _tagsText = State(initialValue: draft.tagsAny.joined(separator: " "))
        self.onSave = onSave
        self.onCancel = onCancel
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Filter") {
                    TextField("Name", text: $draft.name)
                    TextField("SF Symbol", text: $draft.systemImage)
                        .font(.body.monospaced())
                }
                Section("Due") {
                    Picker("Due window", selection: $draft.dueWindow) {
                        ForEach(DueWindow.allCases, id: \.self) { window in
                            Text(window.title).tag(window)
                        }
                    }
                }
                Section("Qualifiers") {
                    Toggle("Only starred", isOn: $draft.starredOnly)
                    Toggle("Include completed", isOn: $draft.includeCompleted)
                }
                Section("Lists (leave empty for all)") {
                    ForEach(model.taskLists) { list in
                        Toggle(list.title, isOn: Binding(
                            get: { draft.taskListIDs.contains(list.id) },
                            set: { isOn in
                                if isOn { draft.taskListIDs.insert(list.id) }
                                else { draft.taskListIDs.remove(list.id) }
                            }
                        ))
                    }
                }
                Section("Tags (space-separated, any match)") {
                    TextField("#work #urgent", text: $tagsText)
                }
            }
            .navigationTitle("Filter")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var out = draft
                        out.tagsAny = tagsText
                            .split(whereSeparator: { $0.isWhitespace })
                            .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "#")) }
                            .filter { $0.isEmpty == false }
                        onSave(out)
                    }
                    .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 480, minHeight: 480)
    }
}
