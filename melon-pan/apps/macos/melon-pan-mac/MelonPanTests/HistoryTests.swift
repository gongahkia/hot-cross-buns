import AppKit
import SwiftUI
import XCTest
@testable import MelonPan

@MainActor
final class HistoryTests: XCTestCase {
    func testRecentSyncEventsFixtureDecodesAndDetailFormatsText() throws {
        let root = tempRoot("journal")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let line = #"{"ts":1714742400,"kind":"push","document_id":"1AbC","revision":"rev:42","message":"queued: revision conflict"}"#
        try line.appending("\n").write(
            to: root.appendingPathComponent("sync-journal.jsonl"),
            atomically: true,
            encoding: .utf8
        )

        let events = try RuntimeBridge.recentSyncEvents(cacheRoot: root.path, limit: 200)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].message, "queued: revision conflict")
        XCTAssertEqual(events[0].documentId, "1AbC")
        XCTAssertEqual(isoTimestamp(events[0].date), "2024-05-03T13:20:00Z")

        let vm = HistoryViewModel(cacheRoot: root.path, configRoot: root.path)
        _ = NSHostingView(rootView: HistoryEventDetail(event: events[0]).environmentObject(vm))

        try? FileManager.default.removeItem(at: root)
    }

    func testRestoreSnapshotRoundTripKeepsSnapshotImmutable() throws {
        let root = tempRoot("restore")
        let docDir = root.appendingPathComponent("docs").appendingPathComponent("doc-1")
        let trashDir = docDir.appendingPathComponent("trash")
        let snapshotDir = root.appendingPathComponent("snapshots").appendingPathComponent("doc-1")
        try FileManager.default.createDirectory(at: trashDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: snapshotDir, withIntermediateDirectories: true)
        let current = docDir.appendingPathComponent("current.md")
        let snapshot = snapshotDir.appendingPathComponent("rev1.md")
        try "v2\n".write(to: current, atomically: true, encoding: .utf8)
        try "v1\n".write(to: snapshot, atomically: true, encoding: .utf8)

        try RuntimeBridge.restoreSnapshot(
            cacheRoot: root.path,
            documentId: "doc-1",
            snapshotPath: snapshot.path
        )

        XCTAssertEqual(try String(contentsOf: current, encoding: .utf8), "v1\n")
        XCTAssertEqual(try String(contentsOf: snapshot, encoding: .utf8), "v1\n")
        let trash = try FileManager.default.contentsOfDirectory(at: trashDir, includingPropertiesForKeys: nil)
        XCTAssertEqual(trash.count, 1)
        XCTAssertEqual(try String(contentsOf: trash[0], encoding: .utf8), "v2\n")

        try? FileManager.default.removeItem(at: root)
    }

    func testHistoryFilterPurity() {
        let base = HistoryEvent(
            timestampUnix: 1_714_742_400,
            kind: .push,
            documentId: "doc-1",
            revision: "rev",
            message: "queued conflict"
        )

        var filter = HistoryFilter()
        XCTAssertTrue(filter.matches(base))

        filter.enabledKinds = [.pull]
        XCTAssertFalse(filter.matches(base))

        filter = HistoryFilter()
        filter.documentId = "doc-2"
        XCTAssertFalse(filter.matches(base))

        filter = HistoryFilter()
        filter.searchText = "conflict"
        XCTAssertTrue(filter.matches(base))
        filter.searchText = "missing"
        XCTAssertFalse(filter.matches(base))

        filter = HistoryFilter()
        filter.dateRange = Date(timeIntervalSince1970: 0)...Date(timeIntervalSince1970: 10)
        XCTAssertFalse(filter.matches(base))
    }

    func testEmptyCacheHistoryEndpointsReturnEmptyArrays() throws {
        let root = tempRoot("empty")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        XCTAssertEqual(try RuntimeBridge.recentSyncEvents(cacheRoot: root.path, limit: 200), [])
        XCTAssertEqual(
            try RuntimeBridge.listRevisionSnapshots(cacheRoot: root.path, documentId: "doc-1"),
            []
        )
        XCTAssertEqual(try RuntimeBridge.loadOpenHistory(configRoot: root.path), [])

        try? FileManager.default.removeItem(at: root)
    }

    private func tempRoot(_ name: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-history-\(name)-\(UUID().uuidString)")
    }
}
