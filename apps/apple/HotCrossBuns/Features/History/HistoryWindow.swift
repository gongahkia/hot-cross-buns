import AppKit
import SwiftUI

// Floating window ledger of all recorded mutations. Reads from MutationAuditLog
// (actor, JSON-persisted at ~/Library/Application Support/<bundleID>/audit.log).
// The undo toast still handles the recent-action convenience; this window is
// the long-memory "did sync drop something? when did I mark that done?" view.
//
// Category filters persist in AppSettings so the user's choice survives
// relaunch. Sync-pulled diffs are excluded from the default filter set
// (too chatty) but visible if the user opts in.
struct HistoryWindow: View {
    @Environment(AppModel.self) private var model
    @State private var entries: [MutationAuditEntry] = []
    @State private var isLoading = true
    @State private var refreshTrigger = UUID()
    @State private var isConfirmingClear = false

    var body: some View {
        VStack(spacing: 0) {
            HistoryFilterChips(
                enabled: Binding(
                    get: { model.settings.historyCategoryFilters },
                    set: { new in
                        let all: Set<String> = ["create", "edit", "delete", "complete", "duplicate", "move", "clipboard", "restore", "bulk", "sync", "other"]
                        for cat in all {
                            let shouldBeEnabled = new.contains(cat)
                            let isEnabled = model.settings.historyCategoryFilters.contains(cat)
                            if shouldBeEnabled != isEnabled {
                                model.setHistoryCategoryEnabled(cat, enabled: shouldBeEnabled)
                            }
                        }
                    }
                )
            )
            .hcbScaledPadding(.horizontal, 14)
            .hcbScaledPadding(.vertical, 10)

            Divider()

            if isLoading {
                VStack { ProgressView().controlSize(.regular) }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if filteredEntries.isEmpty {
                ContentUnavailableView(
                    "No history yet",
                    systemImage: "clock.arrow.circlepath",
                    description: Text(entries.isEmpty
                        ? "Your edits, moves, and syncs will appear here."
                        : "No entries match the current filters.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(filteredEntries, id: \.id) { entry in
                        HistoryEntryRow(entry: entry, onSnapshotCopied: {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(entry.priorSnapshotJSON ?? entry.postSnapshotJSON ?? "", forType: .string)
                        })
                    }
                }
                .listStyle(.plain)
            }

            Divider()

            HStack(spacing: 10) {
                Text("\(filteredEntries.count) of \(entries.count) entries")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button {
                    refreshTrigger = UUID()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                Button(role: .destructive) {
                    isConfirmingClear = true
                } label: {
                    Label("Clear All…", systemImage: "trash")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .hcbScaledPadding(.horizontal, 14)
            .hcbScaledPadding(.vertical, 10)
        }
        .hcbSurface(.inspector)
        .frame(minWidth: 600, minHeight: 420)
        .navigationTitle("History")
        .task(id: refreshTrigger) { await reload() }
        .confirmationDialog(
            "Clear all history?",
            isPresented: $isConfirmingClear,
            titleVisibility: .visible
        ) {
            Button("Clear", role: .destructive) {
                Task {
                    await MutationAuditLog.shared.clear()
                    await reload()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This erases the local audit log. It does not touch Google — your tasks and events are unaffected.")
        }
    }

    private var filteredEntries: [MutationAuditEntry] {
        let limit = model.settings.historyVisibleLimit
        let enabled = model.settings.historyCategoryFilters
        return entries
            .filter { enabled.contains(category(for: $0.kind)) }
            .prefix(limit)
            .map { $0 }
    }

    private func reload() async {
        isLoading = true
        let all = await MutationAuditLog.shared.allEntries()
        entries = all
        isLoading = false
    }

    // maps audit-entry kind strings to the filter category bucket.
    static func category(for kind: String) -> String {
        if kind.hasPrefix("task.create") || kind.hasPrefix("event.create") { return "create" }
        if kind.hasPrefix("task.edit") || kind.hasPrefix("event.edit") { return "edit" }
        if kind.hasPrefix("task.delete") || kind.hasPrefix("event.delete") { return "delete" }
        if kind == "task.complete" || kind == "task.reopen" { return "complete" }
        if kind.hasPrefix("task.duplicate") { return "duplicate" }
        if kind.hasPrefix("task.move") { return "move" }
        if kind.hasPrefix("clipboard.") { return "clipboard" }
        if kind.hasPrefix("task.restore") || kind.hasPrefix("event.restore") { return "restore" }
        if kind.hasPrefix("bulk.") { return "bulk" }
        if kind.hasPrefix("sync.") { return "sync" }
        return "other"
    }

    private func category(for kind: String) -> String {
        HistoryWindow.category(for: kind)
    }
}
