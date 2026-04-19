import AppKit
import SwiftUI

struct DiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var cachePath = "Loading..."
    @State private var isWorking = false
    @State private var confirmation: DiagnosticsConfirmation?
    @State private var copiedAt: Date?
    @State private var lastCrash: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Status") {
                    DiagnosticRow(label: "Google", value: googleStatus)
                    DiagnosticRow(label: "Sync", value: model.syncState.title)
                    DiagnosticRow(label: "Mode", value: model.settings.syncMode.title)
                    DiagnosticRow(label: "Last sync", value: lastSyncText)
                }

                Section("Local data") {
                    DiagnosticRow(label: "Task lists", value: model.taskLists.count.formatted())
                    DiagnosticRow(label: "Tasks", value: model.tasks.count.formatted())
                    DiagnosticRow(label: "Calendars", value: model.calendars.count.formatted())
                    DiagnosticRow(label: "Events", value: model.events.count.formatted())
                    DiagnosticRow(label: "Sync checkpoints", value: model.syncCheckpoints.count.formatted())
                    DiagnosticRow(label: "Pending writes", value: model.pendingMutations.count.formatted())
                }

                Section("Selections") {
                    DiagnosticRow(label: "Selected task lists", value: selectedTaskListText)
                    DiagnosticRow(label: "Selected calendars", value: selectedCalendarText)
                    DiagnosticRow(label: "Local reminders", value: model.settings.enableLocalNotifications ? "Enabled" : "Disabled")
                    DiagnosticRow(label: "Onboarding", value: model.settings.hasCompletedOnboarding ? "Completed" : "Not completed")
                }

                Section("Cache") {
                    Text(cachePath)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }

                if model.pendingMutations.isEmpty == false {
                    Section("Pending sync queue") {
                        ForEach(model.pendingMutations) { mutation in
                            PendingMutationRow(mutation: mutation) {
                                _ = model.clearPendingMutation(id: mutation.id)
                            }
                        }
                        Button(role: .destructive) {
                            model.clearAllPendingMutations()
                        } label: {
                            Label("Clear entire queue", systemImage: "trash")
                        }
                    }
                }

                Section("Recovery") {
                    Button {
                        runRecoveryAction {
                            await model.refreshNow()
                        }
                    } label: {
                        Label("Refresh now", systemImage: "arrow.clockwise")
                    }
                    .disabled(isWorking || model.account == nil)

                    Button {
                        confirmation = .fullResync
                    } label: {
                        Label("Force full resync", systemImage: "arrow.triangle.2.circlepath.circle")
                    }
                    .disabled(isWorking || model.account == nil)

                    Button(role: .destructive) {
                        confirmation = .clearCache
                    } label: {
                        Label("Clear cached Google data", systemImage: "externaldrive.badge.xmark")
                    }
                    .disabled(isWorking)
                }

                if let crash = lastCrash {
                    Section("Previous crash") {
                        Text(crash)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(12)
                        HStack {
                            Button {
                                Clipboard.copy(crash)
                            } label: {
                                Label("Copy crash log", systemImage: "doc.on.doc")
                            }
                            Button(role: .destructive) {
                                CrashReporter.clearLastCrash()
                                lastCrash = nil
                            } label: {
                                Label("Clear", systemImage: "trash")
                            }
                        }
                    }
                }

                Section("Support") {
                    Button {
                        copyDiagnostics()
                    } label: {
                        Label(copiedAt == nil ? "Copy diagnostic summary" : "Copied diagnostic summary", systemImage: copiedAt == nil ? "doc.on.doc" : "checkmark")
                    }
                }
            }
            .navigationTitle("Diagnostics")
            .toolbar {
                Button("Close") {
                    dismiss()
                }
            }
            .overlay {
                if isWorking {
                    ProgressView("Working...")
                        .padding(18)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
            .task {
                cachePath = await model.cacheFilePath()
                lastCrash = CrashReporter.readLastCrash()
            }
            .confirmationDialog(
                confirmation?.title ?? "Confirm",
                isPresented: confirmationBinding,
                titleVisibility: .visible
            ) {
                if let confirmation {
                    Button(confirmation.actionTitle, role: confirmation.role) {
                        handle(confirmation)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(confirmation?.message ?? "")
            }
        }
    }

    private var googleStatus: String {
        if let account = model.account {
            return account.displayName
        }

        return model.authState.title
    }

    private var lastSyncText: String {
        guard let date = model.lastSuccessfulSyncAt else {
            return "Never"
        }

        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private var selectedTaskListText: String {
        if model.settings.hasConfiguredTaskListSelection {
            return "\(model.settings.selectedTaskListIDs.count) of \(model.taskLists.count)"
        }

        return model.taskLists.isEmpty ? "Not loaded" : "All"
    }

    private var selectedCalendarText: String {
        let selectedCount = model.calendars.filter(\.isSelected).count
        if model.settings.hasConfiguredCalendarSelection {
            return "\(model.settings.selectedCalendarIDs.count) of \(model.calendars.count)"
        }

        return model.calendars.isEmpty ? "Not loaded" : "\(selectedCount) default"
    }

    private var confirmationBinding: Binding<Bool> {
        Binding(
            get: { confirmation != nil },
            set: { isPresented in
                if isPresented == false {
                    confirmation = nil
                }
            }
        )
    }

    private func handle(_ confirmation: DiagnosticsConfirmation) {
        switch confirmation {
        case .fullResync:
            runRecoveryAction {
                await model.forceFullResync()
            }
        case .clearCache:
            runRecoveryAction {
                await model.clearCachedGoogleDataAndRefresh()
            }
        }
    }

    private func runRecoveryAction(_ action: @escaping @MainActor () async -> Void) {
        guard isWorking == false else {
            return
        }

        isWorking = true
        Task {
            await action()
            cachePath = await model.cacheFilePath()
            isWorking = false
        }
    }

    private func copyDiagnostics() {
        Clipboard.copy(model.diagnosticSummary(cachePath: cachePath))
        copiedAt = Date()
    }
}

private struct PendingMutationRow: View {
    let mutation: PendingMutation
    let onDrop: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .frame(width: 18, alignment: .center)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                Text(subtitle)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            Button(role: .destructive, action: onDrop) {
                Label("Drop", systemImage: "xmark.circle")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Remove this pending mutation from the queue")
        }
    }

    private var title: String {
        switch (mutation.resourceType, mutation.action) {
        case (.task, .create): "New task"
        case (.task, .update): "Task edit"
        case (.task, .completion): "Task completion"
        case (.task, .delete): "Task delete"
        case (.event, .create): "New event"
        case (.event, .update): "Event edit"
        case (.event, .delete): "Event delete"
        default: "Pending \(mutation.resourceType.rawValue) \(mutation.action.rawValue)"
        }
    }

    private var subtitle: String {
        "\(mutation.resourceID) · queued \(mutation.createdAt.formatted(date: .abbreviated, time: .shortened))"
    }

    private var symbol: String {
        switch mutation.action {
        case .create: "plus.circle"
        case .update: "pencil.circle"
        case .completion: "checkmark.circle"
        case .delete: "trash.circle"
        }
    }

    private var tint: Color {
        switch mutation.action {
        case .create: AppColor.moss
        case .update: AppColor.blue
        case .completion: AppColor.moss
        case .delete: AppColor.ember
        }
    }
}

private struct DiagnosticRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer(minLength: 16)
            Text(value)
                .multilineTextAlignment(.trailing)
        }
    }
}

private enum DiagnosticsConfirmation: Identifiable {
    case fullResync
    case clearCache

    var id: String {
        switch self {
        case .fullResync:
            "fullResync"
        case .clearCache:
            "clearCache"
        }
    }

    var title: String {
        switch self {
        case .fullResync:
            "Force full resync?"
        case .clearCache:
            "Clear cached Google data?"
        }
    }

    var message: String {
        switch self {
        case .fullResync:
            "This clears local sync checkpoints and asks Google for fresh task and calendar state. It keeps your cached data visible during the refresh."
        case .clearCache:
            "This removes cached task lists, tasks, calendars, events, checkpoints, and pending local writes from this device, then refreshes from Google if connected. Your Google account data is not deleted."
        }
    }

    var actionTitle: String {
        switch self {
        case .fullResync:
            "Force Full Resync"
        case .clearCache:
            "Clear Cache"
        }
    }

    var role: ButtonRole? {
        switch self {
        case .fullResync:
            nil
        case .clearCache:
            .destructive
        }
    }
}

private enum Clipboard {
    static func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }
}

#Preview {
    DiagnosticsView()
        .environment(AppModel.preview)
}
