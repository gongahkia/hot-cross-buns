import SwiftUI

// Settings UI for §6.13 task templates. Templates are stored locally and
// never written to Google; instantiation creates a real task with fully
// expanded field values, so the saved task on google.com looks
// indistinguishable from a manually-created one.
struct TemplatesSection: View {
    @Environment(AppModel.self) private var model
    @State private var editor: TaskTemplate?
    @State private var isCreating = false

    var body: some View {
        Section("Task templates") {
            if model.settings.taskTemplates.isEmpty {
                Text("No templates yet. Create one to pre-fill title, notes, due, and list using variables like {{today}}, {{+7d}}, {{nextWeekday:mon}}, {{prompt:Owner}}, or {{clipboard}}.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.settings.taskTemplates) { template in
                    Button {
                        editor = template
                    } label: {
                        HStack {
                            Label(template.name, systemImage: "doc.text")
                            Spacer()
                            Text(template.title.isEmpty ? "(no title)" : template.title)
                                .hcbFont(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            model.deleteTaskTemplate(template.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            Button {
                isCreating = true
            } label: {
                Label("New Task Template", systemImage: "plus")
            }
            Text("Instantiate from the command palette: \"Insert Task Template…\". Variables in {{…}} are expanded before the task is created; unknown variables are left visible so typos don't silently drop values.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
        .sheet(isPresented: $isCreating) {
            TaskTemplateEditor(draft: TaskTemplate(name: "New Template", title: "")) { updated in
                model.upsertTaskTemplate(updated)
                isCreating = false
            } onCancel: {
                isCreating = false
            }
        }
        .sheet(item: $editor) { current in
            TaskTemplateEditor(draft: current) { updated in
                model.upsertTaskTemplate(updated)
                editor = nil
            } onCancel: { editor = nil }
        }
    }
}

private struct TaskTemplateEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var draft: TaskTemplate
    let onSave: (TaskTemplate) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Template") {
                    TextField("Name", text: $draft.name)
                }
                Section("Task") {
                    TextField("Title (required)", text: $draft.title)
                    TextField("Notes", text: $draft.notes, axis: .vertical)
                        .lineLimit(3 ... 8)
                    TextField("Due (e.g. {{today}}, {{+7d}}, 2026-05-01)", text: $draft.due)
                    TextField("List (id, title, or empty for default)", text: $draft.listIdOrTitle)
                }
                Section {
                    let prompts = draft.requiredPrompts()
                    if prompts.isEmpty == false {
                        Text("Prompts at instantiation: \(prompts.joined(separator: ", "))")
                            .hcbFont(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("No {{prompt:Label}} placeholders — the template instantiates without asking for input.")
                            .hcbFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Variables")
                } footer: {
                    Text("{{today}} {{tomorrow}} {{yesterday}} {{+Nd/-Nd/w/m/y}} {{nextWeekday:mon}} {{clipboard}} {{cursor}} {{prompt:Label}}")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Task Template")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(draft) }
                        .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty
                            || draft.title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .hcbScaledFrame(minWidth: 480, minHeight: 460)
    }
}
