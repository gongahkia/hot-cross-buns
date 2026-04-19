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
    @State private var systemCrashReports: [SystemCrashReport] = []
    @State private var notificationSummary: NotificationScheduleSummary?
    @State private var logEntries: [LogEntry] = []
    @State private var logLevelFilter: LogLevel = .info
    @State private var logCopiedAt: Date?
    @State private var expandedSystemReportID: String?
    @State private var systemReportPreview: String = ""

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

                if let summary = notificationSummary {
                    Section("Reminder schedule") {
                        DiagnosticRow(label: "Scheduled events", value: summary.scheduledEvents.formatted())
                        DiagnosticRow(label: "Scheduled tasks", value: summary.scheduledTasks.formatted())
                        if summary.hasDeferred {
                            DiagnosticRow(label: "Deferred events", value: summary.deferredEvents.formatted())
                            DiagnosticRow(label: "Deferred tasks", value: summary.deferredTasks.formatted())
                            Text("More reminders exist in the next \(summary.windowDays) days than macOS allows the app to schedule at once. They will be scheduled as earlier ones fire or are cancelled.")
                                .font(.caption)
                                .foregroundStyle(AppColor.ember)
                        } else {
                            Text("All reminders within the next \(summary.windowDays) days are scheduled.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
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

                if systemCrashReports.isEmpty == false {
                    Section("System crash reports") {
                        Text("macOS writes a symbolicated report each time the app crashes. Use these to see the exact Swift stack.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(systemCrashReports) { report in
                            SystemCrashRow(
                                report: report,
                                isExpanded: expandedSystemReportID == report.id,
                                preview: expandedSystemReportID == report.id ? systemReportPreview : nil,
                                onToggle: {
                                    if expandedSystemReportID == report.id {
                                        expandedSystemReportID = nil
                                        systemReportPreview = ""
                                    } else {
                                        expandedSystemReportID = report.id
                                        systemReportPreview = SystemCrashReportReader.readContents(of: report) ?? "Could not read report file."
                                    }
                                },
                                onCopy: {
                                    if let contents = SystemCrashReportReader.readContents(of: report) {
                                        Clipboard.copy(contents)
                                    }
                                },
                                onReveal: {
                                    NSWorkspace.shared.activateFileViewerSelecting([report.url])
                                }
                            )
                        }
                        if let dir = SystemCrashReportReader.directoryURL() {
                            Button {
                                NSWorkspace.shared.open(dir)
                            } label: {
                                Label("Open folder in Finder", systemImage: "folder")
                            }
                        }
                    }
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

                Section("Logs") {
                    HStack {
                        Picker("Level", selection: $logLevelFilter) {
                            ForEach(LogLevel.allCases, id: \.self) { level in
                                Text(level.rawValue.capitalized).tag(level)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: logLevelFilter) { _, _ in refreshLogs() }
                        Spacer()
                        Button {
                            refreshLogs()
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                    }
                    if logEntries.isEmpty {
                        Text("No log entries at this level yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 2) {
                                ForEach(logEntries) { entry in
                                    LogEntryRow(entry: entry)
                                }
                            }
                        }
                        .frame(maxHeight: 220)
                    }
                    HStack {
                        Button {
                            let full = AppLogger.shared.loadPersistedLog()
                            Clipboard.copy(full.isEmpty ? logEntries.map { $0.formattedLine() }.joined(separator: "\n") : full)
                            logCopiedAt = Date()
                        } label: {
                            Label(logCopiedAt == nil ? "Copy full log" : "Copied", systemImage: logCopiedAt == nil ? "doc.on.doc" : "checkmark")
                        }
                        if let url = AppLogger.shared.currentLogFileURL() {
                            Button {
                                NSWorkspace.shared.activateFileViewerSelecting([url])
                            } label: {
                                Label("Reveal log file", systemImage: "folder")
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
                    Button {
                        Task { await exportDiagnosticBundle() }
                    } label: {
                        Label("Export diagnostic bundle…", systemImage: "square.and.arrow.up")
                    }
                    .help("Save a text file with logs, pending mutations, and state for bug reports. Emails and tokens are redacted.")
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
                systemCrashReports = SystemCrashReportReader.recentReports(limit: 5)
                notificationSummary = await model.notificationScheduleSummary()
                refreshLogs()
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

    private func refreshLogs() {
        logEntries = AppLogger.shared.recentEntries(limit: 200, minimumLevel: logLevelFilter)
    }

    @MainActor
    private func exportDiagnosticBundle() async {
        let url = await DiagnosticBundle.exportToDisk(
            model: model,
            cachePath: cachePath,
            notificationSummary: notificationSummary
        )
        if url != nil {
            copiedAt = Date() // reuse the button-label success indicator
        }
    }
}

private struct LogEntryRow: View {
    let entry: LogEntry

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: entry.level.systemSymbol)
                .font(.caption)
                .foregroundStyle(tint)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text("[\(entry.category.rawValue)] \(entry.message)")
                    .font(.caption.monospaced())
                    .foregroundStyle(AppColor.ink)
                    .lineLimit(3)
                HStack(spacing: 6) {
                    Text(entry.timestamp.formatted(date: .omitted, time: .standard))
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                    if entry.metadata.isEmpty == false {
                        Text(entry.metadata
                            .sorted { $0.key < $1.key }
                            .map { "\($0.key)=\($0.value)" }
                            .joined(separator: " "))
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 1)
    }

    private var tint: Color {
        switch entry.level {
        case .debug: .secondary
        case .info: AppColor.blue
        case .warn: AppColor.ember
        case .error: .red
        }
    }
}

private struct SystemCrashRow: View {
    let report: SystemCrashReport
    let isExpanded: Bool
    let preview: String?
    let onToggle: () -> Void
    let onCopy: () -> Void
    let onReveal: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "ant.circle.fill")
                    .foregroundStyle(AppColor.ember)
                VStack(alignment: .leading, spacing: 1) {
                    Text(report.filename)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(report.modificationDate.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button(isExpanded ? "Hide" : "View", action: onToggle)
                    .buttonStyle(.borderless)
                Button("Copy", action: onCopy)
                    .buttonStyle(.borderless)
                Button("Reveal", action: onReveal)
                    .buttonStyle(.borderless)
            }
            if isExpanded, let preview {
                Text(preview)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(AppColor.cream.opacity(0.6))
                    )
            }
        }
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
