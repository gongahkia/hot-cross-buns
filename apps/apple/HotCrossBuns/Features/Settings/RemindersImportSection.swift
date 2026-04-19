import SwiftUI

struct RemindersImportSection: View {
    @Environment(AppModel.self) private var model
    @State private var isImporting = false
    @State private var stage: Stage = .idle
    @State private var fetchedLists: [AppleRemindersImporter.ImportedList] = []
    @State private var summary: AppModel.RemindersImportSummary?
    @State private var errorMessage: String?

    enum Stage {
        case idle
        case fetching
        case preview
        case importing
        case done
    }

    var body: some View {
        Section("Apple Reminders") {
            switch stage {
            case .idle:
                Text("One-time migration: reads your Reminders lists and inserts each as a Google Tasks list. No ongoing sync.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    Task { await fetch() }
                } label: {
                    Label("Read Reminders…", systemImage: "list.bullet.rectangle")
                }
                .disabled(model.account == nil)

            case .fetching:
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Reading Reminders…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

            case .preview:
                VStack(alignment: .leading, spacing: 6) {
                    Text("Found \(fetchedLists.count) list\(fetchedLists.count == 1 ? "" : "s"), \(fetchedLists.map(\.reminders.count).reduce(0, +)) reminder\(fetchedLists.map(\.reminders.count).reduce(0, +) == 1 ? "" : "s").")
                        .font(.caption)
                    ForEach(fetchedLists, id: \.name) { list in
                        Text("• \(list.name) — \(list.reminders.count)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Button("Cancel") { reset() }
                        Spacer()
                        Button("Import to Google Tasks") {
                            Task { await performImport() }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppColor.ember)
                    }
                }

            case .importing:
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Creating task lists and tasks…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

            case .done:
                if let summary {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Imported \(summary.createdTasks) reminder\(summary.createdTasks == 1 ? "" : "s") across \(summary.createdLists) new list\(summary.createdLists == 1 ? "" : "s").")
                            .font(.caption)
                        if summary.errors > 0 {
                            Text("\(summary.errors) item\(summary.errors == 1 ? "" : "s") failed — check Diagnostics.")
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                    Button("Done") { reset() }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func fetch() async {
        errorMessage = nil
        stage = .fetching
        do {
            let lists = try await AppleRemindersImporter().requestAccessAndFetch()
            fetchedLists = lists
            stage = .preview
        } catch {
            errorMessage = error.localizedDescription
            stage = .idle
        }
    }

    private func performImport() async {
        stage = .importing
        let summary = await model.importAppleReminders(fetchedLists)
        self.summary = summary
        stage = .done
    }

    private func reset() {
        stage = .idle
        fetchedLists = []
        summary = nil
        errorMessage = nil
    }
}
