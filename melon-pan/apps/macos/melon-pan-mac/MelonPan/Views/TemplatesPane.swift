import SwiftUI

protocol TemplatesRuntimeBridging: Sendable {
    func templatesList(cacheRoot: String) throws -> [TemplateInfo]
    func templateSave(cacheRoot: String, template: MarkdownTemplate) throws
    func templateDelete(cacheRoot: String, id: UUID) throws
    func templateLoad(cacheRoot: String, id: UUID) throws -> MarkdownTemplate
    func templateExpand(body: String, title: String, author: String) throws -> String
}

struct LiveTemplatesRuntimeBridge: TemplatesRuntimeBridging {
    func templatesList(cacheRoot: String) throws -> [TemplateInfo] {
        try RuntimeBridge.templatesList(cacheRoot: cacheRoot)
    }

    func templateSave(cacheRoot: String, template: MarkdownTemplate) throws {
        try RuntimeBridge.templateSave(cacheRoot: cacheRoot, template: template)
    }

    func templateDelete(cacheRoot: String, id: UUID) throws {
        try RuntimeBridge.templateDelete(cacheRoot: cacheRoot, id: id)
    }

    func templateLoad(cacheRoot: String, id: UUID) throws -> MarkdownTemplate {
        try RuntimeBridge.templateLoad(cacheRoot: cacheRoot, id: id)
    }

    func templateExpand(body: String, title: String, author: String) throws -> String {
        try RuntimeBridge.templateExpand(body: body, title: title, author: author)
    }
}

struct TemplatesPane: View {
    @EnvironmentObject private var session: AppSession
    @StateObject private var vm = TemplatesViewModel()
    @State private var editing: MarkdownTemplate? = nil
    @State private var creatingNew = false
    @State private var pendingDelete: TemplateInfo? = nil

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            content
        }
        .onAppear {
            vm.load(cacheRoot: session.cacheRoot)
        }
        .sheet(isPresented: $creatingNew) {
            TemplateEditorSheet(template: nil) { template in
                vm.save(template, cacheRoot: session.cacheRoot)
                creatingNew = false
            } onCancel: {
                creatingNew = false
            }
        }
        .sheet(item: $editing) { template in
            TemplateEditorSheet(template: template) { updated in
                vm.save(updated, cacheRoot: session.cacheRoot)
                editing = nil
            } onCancel: {
                editing = nil
            }
        }
        .alert(item: $pendingDelete) { info in
            Alert(
                title: Text("Delete template?"),
                message: Text("Delete \"\(info.name)\" from the local templates folder."),
                primaryButton: .destructive(Text("Delete")) {
                    vm.delete(info, cacheRoot: session.cacheRoot)
                },
                secondaryButton: .cancel()
            )
        }
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button {
                creatingNew = true
            } label: {
                Label("New", systemImage: "plus")
            }

            Button {
                vm.beginEdit(cacheRoot: session.cacheRoot) { template in
                    editing = template
                }
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            .disabled(vm.selectedInfo == nil)

            Button {
                pendingDelete = vm.selectedInfo
            } label: {
                Label("Delete", systemImage: "trash")
            }
            .disabled(vm.selectedInfo == nil)

            Spacer()

            Button {
                useSelected()
            } label: {
                Label("Use as new draft", systemImage: "doc.badge.plus")
            }
            .keyboardShortcut(.return, modifiers: [])
            .buttonStyle(.borderedProminent)
            .disabled(vm.selectedInfo == nil)
        }
        .padding(12)
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = vm.error {
                HStack(spacing: 8) {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                    Spacer()
                    Button("Retry") {
                        vm.load(cacheRoot: session.cacheRoot)
                    }
                    .controlSize(.small)
                }
                .font(.caption)
            }

            if vm.templates.isEmpty {
                emptyState
            } else {
                List(selection: $vm.selectedId) {
                    ForEach(vm.templates) { info in
                        templateRow(info)
                            .tag(info.id)
                            .contextMenu {
                                Button("Edit") {
                                    vm.beginEdit(cacheRoot: session.cacheRoot) { template in
                                        editing = template
                                    }
                                }
                                Button("Use as new draft") {
                                    vm.selectedId = info.id
                                    useSelected()
                                }
                                Divider()
                                Button("Delete", role: .destructive) {
                                    pendingDelete = info
                                }
                            }
                    }
                }
                .listStyle(.inset)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.on.doc")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("No templates")
                .font(.headline)
            Text("Create a local Markdown starter to use as a new draft.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                creatingNew = true
            } label: {
                Label("New Template", systemImage: "plus")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func templateRow(_ info: TemplateInfo) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text")
                .foregroundStyle(.secondary)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(info.name)
                    .lineLimit(1)
                Text(Self.updatedFormatter.string(from: info.updatedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func useSelected() {
        guard let info = vm.selectedInfo else { return }
        do {
            let body = try vm.expand(info, session: session)
            session.openInTab(OpenDocument(
                documentId: "draft-\(UInt64(Date().timeIntervalSince1970 * 1000))",
                title: info.name,
                plainText: body
            ))
            session.activePane = .home
        } catch {
            vm.error = "expand: \(error)"
        }
    }

    private static let updatedFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

@MainActor
final class TemplatesViewModel: ObservableObject {
    @Published var templates: [TemplateInfo] = []
    @Published var selectedId: UUID? = nil
    @Published var error: String? = nil

    var bridge: any TemplatesRuntimeBridging = LiveTemplatesRuntimeBridge()
    var selectedInfo: TemplateInfo? {
        templates.first(where: { $0.id == selectedId })
    }

    func load(cacheRoot: String) {
        do {
            templates = try bridge.templatesList(cacheRoot: cacheRoot)
            if let selectedId, !templates.contains(where: { $0.id == selectedId }) {
                self.selectedId = nil
            }
            error = nil
        } catch {
            self.error = "\(error)"
        }
    }

    func save(_ template: MarkdownTemplate, cacheRoot: String) {
        do {
            try bridge.templateSave(cacheRoot: cacheRoot, template: template)
            load(cacheRoot: cacheRoot)
            selectedId = template.id
        } catch {
            self.error = "\(error)"
        }
    }

    func delete(_ info: TemplateInfo, cacheRoot: String) {
        do {
            try bridge.templateDelete(cacheRoot: cacheRoot, id: info.id)
            load(cacheRoot: cacheRoot)
        } catch {
            self.error = "\(error)"
        }
    }

    func beginEdit(cacheRoot: String, present: (MarkdownTemplate) -> Void) {
        guard let info = selectedInfo else { return }
        do {
            present(try bridge.templateLoad(cacheRoot: cacheRoot, id: info.id))
            error = nil
        } catch {
            self.error = "\(error)"
        }
    }

    func expand(_ info: TemplateInfo, session: AppSession) throws -> String {
        let template = try bridge.templateLoad(cacheRoot: session.cacheRoot, id: info.id)
        return try bridge.templateExpand(
            body: template.body,
            title: template.name,
            author: session.activeAccount ?? ""
        )
    }
}
