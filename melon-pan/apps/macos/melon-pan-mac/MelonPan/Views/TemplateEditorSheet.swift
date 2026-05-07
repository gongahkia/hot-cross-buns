import SwiftUI

struct TemplateEditorSheet: View {
    let template: MarkdownTemplate?
    let onSave: (MarkdownTemplate) -> Void
    let onCancel: () -> Void

    @State private var name: String
    @State private var bodyText: String

    init(
        template: MarkdownTemplate?,
        onSave: @escaping (MarkdownTemplate) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.template = template
        self.onSave = onSave
        self.onCancel = onCancel
        _name = State(initialValue: template?.name ?? "")
        _bodyText = State(initialValue: template?.body ?? defaultBody)
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                Text(template == nil ? "New template" : "Edit template")
                    .font(.title2.weight(.semibold))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Name")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("Weekly Review", text: $name)
                        .textFieldStyle(.roundedBorder)
                    Text("Variables: {{date}} {{time}} {{datetime}} {{title}} {{author}} {{cursor}}")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                TextEditor(text: $bodyText)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 260)
                    .scrollContentBackground(.hidden)
                    .background(Color(nsColor: .textBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .padding(20)

            Divider()

            HStack {
                Spacer()
                Button("Cancel") {
                    onCancel()
                }
                .keyboardShortcut(.cancelAction)

                Button("Save") {
                    save()
                }
                .keyboardShortcut("s", modifiers: .command)
                .buttonStyle(.borderedProminent)
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
        }
        .frame(minWidth: 560, minHeight: 460)
    }

    private func save() {
        let now = Date()
        let updated = MarkdownTemplate(
            id: template?.id ?? UUID(),
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            body: bodyText,
            createdAt: template?.createdAt ?? now,
            updatedAt: now
        )
        onSave(updated)
    }
}

private let defaultBody = "# {{title}}\n\nDate: {{date}}\n\n## Notes\n\n{{cursor}}\n"
