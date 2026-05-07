import SwiftUI

struct SnapshotDetail: View {
    let snapshot: SnapshotInfo
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var vm: HistoryViewModel
    @State private var snapshotMd = ""
    @State private var currentMd = ""
    @State private var pending: RuntimeBridge.DocPendingSummary? = nil
    @State private var confirmRestore = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            metadataHeader
            Divider()
            if let pending, !pending.pendingMutations.isEmpty {
                Label(
                    "This document has \(pending.pendingMutations.count) pending mutation(s). Drain or discard them in the Conflicts pane before restoring.",
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.orange)
                .font(.caption)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    GroupBox("Markdown") {
                        Text(snapshotMd)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    GroupBox("Diff vs current.md") {
                        Text(makeLineDiff(from: currentMd, to: snapshotMd))
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.vertical, 4)
            }
            HStack {
                Button(role: .destructive) {
                    confirmRestore = true
                } label: {
                    Label("Restore to current", systemImage: "arrow.uturn.backward")
                }
                .keyboardShortcut(.return, modifiers: [.command, .shift])
                .disabled((pending?.pendingMutations.count ?? 0) > 0)
                Spacer()
            }
        }
        .padding(16)
        .task(id: snapshot.id) { await loadBuffers() }
        .confirmationDialog(
            "Restore this snapshot?",
            isPresented: $confirmRestore,
            titleVisibility: .visible
        ) {
            Button("Restore", role: .destructive) {
                Task {
                    do {
                        try await vm.restore(snapshot)
                        session.refreshOpenDocumentFromCache(documentId: snapshot.documentId)
                    } catch {
                        vm.lastError = "\(error)"
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("current.md is archived to trash and replaced with the snapshot bytes.")
        }
    }

    private var metadataHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(snapshot.revisionOrStamp)
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            HStack(spacing: 8) {
                Label(snapshot.kind.label, systemImage: snapshot.kind.systemImage)
                Text(snapshot.createdAt.formatted(date: .complete, time: .standard))
                Text(humanizeBytes(snapshot.sizeBytes))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private func loadBuffers() async {
        snapshotMd = (try? String(contentsOfFile: snapshot.markdownPath, encoding: .utf8)) ?? ""
        let currentPath = URL(fileURLWithPath: vm.cacheRoot)
            .appendingPathComponent("docs")
            .appendingPathComponent(safePathSegment(snapshot.documentId))
            .appendingPathComponent("current.md")
            .path
        currentMd = (try? String(contentsOfFile: currentPath, encoding: .utf8)) ?? ""
        pending = try? RuntimeBridge.docPendingSummary(
            cacheRoot: vm.cacheRoot,
            documentId: snapshot.documentId
        )
    }
}

func makeLineDiff(from current: String, to candidate: String) -> String {
    let oldLines = current.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let newLines = candidate.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let count = max(oldLines.count, newLines.count)
    var out: [String] = []
    for index in 0..<count {
        let old = index < oldLines.count ? oldLines[index] : nil
        let new = index < newLines.count ? newLines[index] : nil
        if old == new {
            out.append("  \(old ?? "")")
        } else {
            if let old { out.append("- \(old)") }
            if let new { out.append("+ \(new)") }
        }
    }
    return out.joined(separator: "\n")
}
