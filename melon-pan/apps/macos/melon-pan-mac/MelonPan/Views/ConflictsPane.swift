// Conflicts pane: per-doc list of pending mutations, pre-push
// snapshots, and recent revision-conflict journal entries. Pure UI over
// the FFI; no on-disk knowledge in the SwiftUI layer beyond the cache
// root.

import SwiftUI

struct ConflictsPane: View {
    @EnvironmentObject private var session: AppSession
    @State private var summaries: [RuntimeBridge.DocPendingSummary] = []
    @State private var docTitles: [String: String] = [:]
    @State private var revisionConflictDocIds: Set<String> = []
    @State private var lastError: String? = nil
    @State private var refreshing = false
    @State private var draining: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Conflicts")
                    .font(.title2)
                Spacer()
                if refreshing {
                    ProgressView()
                        .controlSize(.small)
                }
                Button {
                    refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(refreshing)
            }

            if !summaries.isEmpty {
                Text("Review queued edits, revision conflicts, and restorable snapshots before pushing them back to Google Docs.")
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }

            if let lastError {
                Text(lastError)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            if summaries.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(summaries, id: \.documentId) { summary in
                            documentSection(summary: summary)
                                .padding(.vertical, 4)
                            Divider()
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            refresh()
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("No pending conflicts", systemImage: "checkmark.circle")
                .foregroundStyle(.green)
            Text("Queued edits, failed revision pushes, and restorable snapshots will appear here.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func documentSection(summary: RuntimeBridge.DocPendingSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Label(docTitles[summary.documentId] ?? summary.documentId, systemImage: "doc.text")
                        .font(.headline)
                    Text(summary.documentId)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if draining == summary.documentId {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("Draining…").font(.caption)
                    }
                } else {
                    if revisionConflictDocIds.contains(summary.documentId) {
                        Button("Review Merge") {
                            session.requestConflictReview(documentId: summary.documentId)
                        }
                        .controlSize(.small)
                        .help("Open this document and prepare merge choices against the latest server revision.")
                        .disabled(session.activeAccount == nil)
                    }
                    if !summary.pendingMutations.isEmpty {
                        Button("Drain") {
                            drain(documentId: summary.documentId)
                        }
                        .controlSize(.small)
                        .help("Replay every pending mutation against the latest server revision.")
                        .disabled(session.activeAccount == nil)
                    }
                }
            }

            if revisionConflictDocIds.contains(summary.documentId) {
                Label("Recent revision conflict", systemImage: "arrow.triangle.merge")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            if !summary.pendingMutations.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pending mutations (\(summary.pendingMutations.count))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(summary.pendingMutations, id: \.self) { path in
                        Text(URL(fileURLWithPath: path).lastPathComponent)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !summary.prePushSnapshots.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pre-push snapshots (\(summary.prePushSnapshots.count))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(summary.prePushSnapshots, id: \.self) { path in
                        HStack {
                            Text(URL(fileURLWithPath: path).lastPathComponent)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Restore") {
                                restore(
                                    documentId: summary.documentId,
                                    snapshotPath: path
                                )
                            }
                            .controlSize(.small)
                            .help("Rewind current.md to this snapshot. Previous current.md archived to trash.")
                        }
                    }
                }
            }
        }
    }

    private func refresh() {
        refreshing = true
        lastError = nil
        let cacheRoot = session.cacheRoot
        Task.detached(priority: .userInitiated) {
            do {
                let ids = try RuntimeBridge.listCachedDocumentIds(cacheRoot: cacheRoot)
                let docs = (try? RuntimeBridge.enumerateCachedDocs(cacheRoot: cacheRoot)) ?? []
                let titleMap = Dictionary(uniqueKeysWithValues: docs.map { ($0.id, $0.title) })
                let recentConflicts = (try? RuntimeBridge.recentSyncEvents(cacheRoot: cacheRoot, limit: 200)) ?? []
                let conflictIds = Set(recentConflicts.compactMap { event -> String? in
                    guard event.kind == .conflict ||
                            event.message.localizedCaseInsensitiveContains("revision conflict") ||
                            event.message.localizedCaseInsensitiveContains("revision rejected")
                    else { return nil }
                    return event.documentId
                })
                var collected: [RuntimeBridge.DocPendingSummary] = []
                for id in ids {
                    let summary = try RuntimeBridge.docPendingSummary(
                        cacheRoot: cacheRoot,
                        documentId: id
                    )
                    if !summary.isEmpty || conflictIds.contains(id) {
                        collected.append(summary)
                    }
                }
                let collectedSummaries = collected
                await MainActor.run {
                    summaries = collectedSummaries
                    docTitles = titleMap
                    revisionConflictDocIds = conflictIds
                    refreshing = false
                }
            } catch {
                await MainActor.run {
                    lastError = "\(error)"
                    refreshing = false
                }
            }
        }
    }

    private func drain(documentId: String) {
        guard let account = session.activeAccount else {
            lastError = "Sign in first to drain."
            return
        }
        draining = documentId
        lastError = nil
        AppStatusCenter.shared.postSyncing()
        let credentials = session.credentialsPath
        let cacheRoot = session.cacheRoot
        Task.detached(priority: .userInitiated) {
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                _ = try RuntimeBridge.drainPending(
                    accessToken: token,
                    documentId: documentId,
                    cacheRoot: cacheRoot
                )
                await MainActor.run {
                    AppStatusCenter.shared.clear(dedupeKey: "drain:\(documentId)")
                }
            } catch {
                await MainActor.run {
                    lastError = "\(error)"
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "drain:\(documentId)",
                        kind: .error,
                        title: "Drain failed",
                        detail: "\(error)",
                        primaryAction: BannerAction(label: "Retry") {
                            drain(documentId: documentId)
                        },
                        secondaryAction: AppStatusCenter.shared.diagnosticsAction(),
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
            await MainActor.run {
                draining = nil
                refresh()
            }
        }
    }

    private func restore(documentId: String, snapshotPath: String) {
        let cacheRoot = session.cacheRoot
        do {
            try RuntimeBridge.restoreSnapshot(
                cacheRoot: cacheRoot,
                documentId: documentId,
                snapshotPath: snapshotPath
            )
            // Refresh so the user can see whether the snapshot list shrank
            // (it shouldn't — restore preserves the snapshot file).
            refresh()
        } catch {
            lastError = "Restore failed: \(error)"
        }
    }
}
