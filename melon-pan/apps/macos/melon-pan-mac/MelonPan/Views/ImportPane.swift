import SwiftUI
import UniformTypeIdentifiers

struct ImportPane: View {
    @EnvironmentObject private var session: AppSession
    @StateObject private var vm = ImportViewModel()
    @State private var pickingFiles = false
    @State private var pickingFolder = false
    @State private var dropTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            optionsSection
            dropZone
            actionRow
            resultsList
        }
        .padding(16)
        .onAppear { vm.session = session }
        .onChange(of: session.activeAccount) { account in
            if account == nil {
                vm.options.pushToDrive = false
            }
        }
        .fileImporter(
            isPresented: $pickingFiles,
            allowedContentTypes: Self.markdownTypes,
            allowsMultipleSelection: true,
            onCompletion: handle
        )
        .fileImporter(
            isPresented: $pickingFolder,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false,
            onCompletion: handle
        )
        .alert("Confirm import", isPresented: confirmationPresented) {
            Button("Import") { vm.confirmPendingImport() }
            Button("Cancel", role: .cancel) { vm.cancelPendingImport() }
        } message: {
            Text(confirmationMessage)
        }
    }

    static var markdownTypes: [UTType] {
        var types: [UTType] = [.plainText]
        if let md = UTType(filenameExtension: "md") {
            types.append(md)
        }
        if let markdown = UTType("net.daringfireball.markdown") {
            types.append(markdown)
        }
        return types
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Import")
                .font(.title2.weight(.semibold))
            Text("Bring local Markdown into the cache as editable drafts.")
                .foregroundStyle(.secondary)
        }
    }

    private var optionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Push to Drive after import", isOn: $vm.options.pushToDrive)
                .disabled(session.activeAccount == nil || vm.inFlight)
            if session.activeAccount == nil {
                Text("Sign in to push on import.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Picker("Collision", selection: $vm.options.collision) {
                ForEach(ImportOptions.Collision.allCases) { collision in
                    Text(collision.rawValue.capitalized).tag(collision)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 280)
        }
    }

    private var dropZone: some View {
        VStack(spacing: 8) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 30, weight: .medium))
                .foregroundStyle(dropTargeted ? Color.accentColor : Color.secondary)
            Text("Drop Markdown files or folders")
                .font(.headline)
            Text(".md and .markdown files are imported recursively from folders.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .background {
            RoundedRectangle(cornerRadius: 8)
                .fill(dropTargeted ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.06))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(dropTargeted ? Color.accentColor : Color.secondary.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [6]))
        }
        .dropDestination(for: URL.self) { urls, _ in
            vm.enqueue(urls: urls)
            return true
        } isTargeted: { targeted in
            dropTargeted = targeted
        }
    }

    private var actionRow: some View {
        HStack(spacing: 8) {
            Button {
                pickingFiles = true
            } label: {
                Label("Choose Files...", systemImage: "doc.badge.plus")
            }
            .keyboardShortcut("o", modifiers: .command)
            .disabled(vm.inFlight)

            Button {
                pickingFolder = true
            } label: {
                Label("Choose Folder...", systemImage: "folder.badge.plus")
            }
            .keyboardShortcut("o", modifiers: [.command, .shift])
            .disabled(vm.inFlight)

            Spacer()

            Button("Clear") {
                vm.clear()
            }
            .disabled(vm.jobs.isEmpty || vm.inFlight)

            Button {
                Task { await vm.runAll() }
            } label: {
                Label("Run Import", systemImage: "play.fill")
            }
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(vm.jobs.isEmpty || vm.inFlight)
        }
    }

    private var resultsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let lastError = vm.lastError {
                Label(lastError, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
            if vm.jobs.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(.secondary)
                    Text("No imports queued")
                        .font(.headline)
                    Text("Choose files, choose a folder, or drop Markdown here.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(vm.jobs) { job in
                        ImportResultRow(job: job) { documentId in
                            session.openDocumentById(documentId)
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var confirmationPresented: Binding<Bool> {
        Binding(
            get: { vm.pendingConfirmation != nil },
            set: { if !$0 { vm.cancelPendingImport() } }
        )
    }

    private var confirmationMessage: String {
        guard let pending = vm.pendingConfirmation else { return "" }
        switch pending.kind {
        case .folderLimit(let found):
            return "Found \(found) Markdown files. Import all?"
        case .largeFiles:
            return "One or more selected files is larger than 10 MB. Import anyway?"
        }
    }

    private func handle(result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            vm.enqueue(urls: urls)
        case .failure(let error):
            vm.lastError = "\(error)"
        }
    }
}
