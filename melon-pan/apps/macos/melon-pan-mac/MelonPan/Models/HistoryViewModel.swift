import Combine
import Foundation

@MainActor
final class HistoryViewModel: ObservableObject {
    enum Tab: String, CaseIterable, Identifiable {
        case events, snapshots, openHistory

        var id: String { rawValue }

        var label: String {
            switch self {
            case .events: "Events"
            case .snapshots: "Snapshots"
            case .openHistory: "Recently opened"
            }
        }

        var systemImage: String {
            switch self {
            case .events: "clock.arrow.circlepath"
            case .snapshots: "tray.full"
            case .openHistory: "doc.text.magnifyingglass"
            }
        }
    }

    @Published var activeTab: Tab = .events
    @Published var filter = HistoryFilter()
    @Published var events: [HistoryEvent] = []
    @Published var visibleEvents: [HistoryEvent] = []
    @Published var snapshots: [String: [SnapshotInfo]] = [:]
    @Published var openHistory: [OpenHistoryEntry] = []
    @Published var selectedEvent: HistoryEvent? = nil
    @Published var selectedSnapshot: SnapshotInfo? = nil
    @Published var selectedDocumentId: String? = nil
    @Published var cachedDocumentIds: [String] = []
    @Published var loading = false
    @Published var lastError: String? = nil
    @Published var pageSize: Int = 200

    let cacheRoot: String
    let configRoot: String

    init(cacheRoot: String, configRoot: String) {
        self.cacheRoot = cacheRoot
        self.configRoot = configRoot
    }

    var documentIds: [String] {
        let ids = Set(cachedDocumentIds)
            .union(events.map(\.documentId))
            .union(snapshots.keys)
        return ids.sorted()
    }

    func reload() async {
        loading = true
        lastError = nil
        defer { loading = false }
        do {
            events = try RuntimeBridge.recentSyncEvents(cacheRoot: cacheRoot, limit: 5_000)
            cachedDocumentIds = try RuntimeBridge.listCachedDocumentIds(cacheRoot: cacheRoot)
            openHistory = try RuntimeBridge.loadOpenHistory(configRoot: configRoot)
            applyFilter()
            if selectedDocumentId == nil {
                selectedDocumentId = documentIds.first
            }
            if let selectedDocumentId {
                await reloadSnapshots(documentId: selectedDocumentId)
            }
        } catch {
            lastError = "\(error)"
            applyFilter()
        }
    }

    func reloadSnapshots(documentId: String) async {
        lastError = nil
        do {
            let revisions = try RuntimeBridge.listRevisionSnapshots(
                cacheRoot: cacheRoot,
                documentId: documentId
            )
            let pending = try RuntimeBridge.docPendingSummary(
                cacheRoot: cacheRoot,
                documentId: documentId
            )
            let prePush = pending.prePushSnapshots.map {
                Self.prePushSnapshotInfo(documentId: documentId, path: $0)
            }
            let all = (revisions + prePush).sorted {
                if $0.createdAtUnix == $1.createdAtUnix {
                    return $0.revisionOrStamp > $1.revisionOrStamp
                }
                return $0.createdAtUnix > $1.createdAtUnix
            }
            snapshots[documentId] = all
            if selectedSnapshot?.documentId != documentId {
                selectedSnapshot = all.first
            }
        } catch {
            lastError = "\(error)"
            snapshots[documentId] = []
        }
    }

    func restore(_ snapshot: SnapshotInfo) async throws {
        try RuntimeBridge.restoreSnapshot(
            cacheRoot: cacheRoot,
            documentId: snapshot.documentId,
            snapshotPath: snapshot.markdownPath
        )
        await reloadSnapshots(documentId: snapshot.documentId)
        events = try RuntimeBridge.recentSyncEvents(cacheRoot: cacheRoot, limit: UInt32(pageSize))
        applyFilter()
    }

    func clearJournal(retainDays: Int) async throws {
        try RuntimeBridge.clearJournal(cacheRoot: cacheRoot, retainDays: UInt32(retainDays))
        events = try RuntimeBridge.recentSyncEvents(cacheRoot: cacheRoot, limit: 5_000)
        applyFilter()
    }

    func applyFilter() {
        visibleEvents = events.lazy.filter(filter.matches).prefix(pageSize).map { $0 }
    }

    func focus(documentId: String) {
        filter.documentId = documentId
        selectedDocumentId = documentId
        activeTab = .events
        applyFilter()
    }

    private static func prePushSnapshotInfo(documentId: String, path: String) -> SnapshotInfo {
        let url = URL(fileURLWithPath: path)
        let attributes = (try? FileManager.default.attributesOfItem(atPath: path)) ?? [:]
        let size = attributes[.size] as? UInt64
            ?? (attributes[.size] as? NSNumber)?.uint64Value
            ?? 0
        let modified = attributes[.modificationDate] as? Date
            ?? attributes[.creationDate] as? Date
            ?? Date(timeIntervalSince1970: 0)
        return SnapshotInfo(
            documentId: documentId,
            kind: .prePush,
            revisionOrStamp: url.deletingPathExtension().lastPathComponent,
            markdownPath: path,
            docsJsonPath: nil,
            createdAtUnix: UInt64(max(0, modified.timeIntervalSince1970)),
            sizeBytes: size
        )
    }
}
