import XCTest
import CryptoKit
@testable import HotCrossBunsMac

// Tests for B2 — events split into a sidecar file (`cache-events.json`).
// Covers: split-on-write, merge-on-load, hash-skip when events unchanged,
// legacy monolithic-format migration, encrypted split, sidecar corruption
// fallback. Each test runs in a fresh temp dir so they're hermetic.
final class LocalCacheStoreSplitTests: XCTestCase {
    private var tempDir: URL!
    private var mainFileURL: URL!
    private var eventsFileURL: URL!

    override func setUpWithError() throws {
        tempDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appending(path: "hcb-cache-split-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        mainFileURL = tempDir.appending(path: "cache-state.json")
        eventsFileURL = tempDir.appending(path: "cache-events.json")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempDir)
    }

    // MARK: - Split

    func testSaveWritesEventsToSidecarAndStripsThemFromMain() async throws {
        let store = LocalCacheStore(fileURL: mainFileURL)
        let state = makeState(events: [makeEvent(id: "e1"), makeEvent(id: "e2")])
        await store.save(state)

        XCTAssertTrue(FileManager.default.fileExists(atPath: mainFileURL.path),
                      "main cache file should exist")
        XCTAssertTrue(FileManager.default.fileExists(atPath: eventsFileURL.path),
                      "events sidecar should exist")

        let mainData = try Data(contentsOf: mainFileURL)
        let mainDecoded = try JSONDecoder.testCacheDecoder.decode(CachedAppState.self, from: mainData)
        XCTAssertTrue(mainDecoded.events.isEmpty,
                      "main file should not carry events post-split")

        let sidecarData = try Data(contentsOf: eventsFileURL)
        let sidecarEvents = try JSONDecoder.testCacheDecoder.decode([CalendarEventMirror].self, from: sidecarData)
        XCTAssertEqual(sidecarEvents.count, 2)
        XCTAssertEqual(Set(sidecarEvents.map(\.id)), ["e1", "e2"])
    }

    func testLoadMergesEventsFromSidecar() async throws {
        let store = LocalCacheStore(fileURL: mainFileURL)
        let original = makeState(events: [makeEvent(id: "a"), makeEvent(id: "b"), makeEvent(id: "c")])
        await store.save(original)

        // Fresh store instance against the same files — simulates a relaunch
        // with the cache already on disk.
        let reloader = LocalCacheStore(fileURL: mainFileURL)
        let loaded = await reloader.loadCachedState()

        XCTAssertEqual(loaded.events.count, 3)
        XCTAssertEqual(Set(loaded.events.map(\.id)), ["a", "b", "c"])
        XCTAssertEqual(loaded.tasks.count, original.tasks.count)
    }

    // MARK: - Hash-skip

    func testRedundantSaveSkipsSidecarWrite() async throws {
        let store = LocalCacheStore(fileURL: mainFileURL)
        let state = makeState(events: [makeEvent(id: "x"), makeEvent(id: "y")])
        await store.save(state)

        let firstMtime = try sidecarModificationDate()

        // Sleep briefly so any second write would produce a different mtime.
        try await Task.sleep(for: .milliseconds(50))

        // Re-save the IDENTICAL state. Hash should match → sidecar untouched.
        await store.save(state)

        let secondMtime = try sidecarModificationDate()
        XCTAssertEqual(firstMtime, secondMtime,
                       "events sidecar should not be rewritten when events hash is unchanged")
    }

    func testEventsChangeTriggersSidecarRewrite() async throws {
        let store = LocalCacheStore(fileURL: mainFileURL)
        let state1 = makeState(events: [makeEvent(id: "a")])
        await store.save(state1)
        let firstMtime = try sidecarModificationDate()

        try await Task.sleep(for: .milliseconds(50))

        // New events array → hash changes → sidecar must be rewritten.
        let state2 = makeState(events: [makeEvent(id: "a"), makeEvent(id: "b")])
        await store.save(state2)

        let secondMtime = try sidecarModificationDate()
        XCTAssertGreaterThan(secondMtime, firstMtime,
                             "events sidecar should rewrite when events hash changes")
    }

    func testEtagChangeOnSameIdTriggersSidecarRewrite() async throws {
        let store = LocalCacheStore(fileURL: mainFileURL)
        let state1 = makeState(events: [makeEvent(id: "a", etag: "v1")])
        await store.save(state1)
        let firstMtime = try sidecarModificationDate()

        try await Task.sleep(for: .milliseconds(50))

        // Same id, different etag — represents a remote update. Hash must
        // detect it so the sidecar reflects the new etag.
        let state2 = makeState(events: [makeEvent(id: "a", etag: "v2")])
        await store.save(state2)

        let secondMtime = try sidecarModificationDate()
        XCTAssertGreaterThan(secondMtime, firstMtime,
                             "etag change on same event id should still bust the hash")
    }

    func testNonEventStateChangesDoNotRewriteSidecar() async throws {
        let store = LocalCacheStore(fileURL: mainFileURL)
        let state = makeState(events: [makeEvent(id: "z")])
        await store.save(state)
        let firstMtime = try sidecarModificationDate()

        try await Task.sleep(for: .milliseconds(50))

        // Mutate something OTHER than events — settings change shouldn't
        // touch the events sidecar.
        var mutated = state
        mutated.settings.syncMode = .nearRealtime
        await store.save(mutated)

        let secondMtime = try sidecarModificationDate()
        XCTAssertEqual(firstMtime, secondMtime,
                       "settings-only changes must not rewrite the events sidecar")
    }

    // MARK: - Legacy migration

    func testLegacyMonolithicCacheLoadsEvents() async throws {
        // Hand-write a legacy-format file (events embedded in main, no sidecar).
        let legacyState = makeState(events: [makeEvent(id: "legacy1"), makeEvent(id: "legacy2")])
        let legacyData = try JSONEncoder.testCacheEncoder.encode(legacyState)
        try legacyData.write(to: mainFileURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: eventsFileURL.path),
                       "precondition: sidecar absent")

        let store = LocalCacheStore(fileURL: mainFileURL)
        let loaded = await store.loadCachedState()

        XCTAssertEqual(loaded.events.count, 2)
        XCTAssertEqual(Set(loaded.events.map(\.id)), ["legacy1", "legacy2"])
    }

    func testFirstSaveAfterLegacyLoadCreatesSidecar() async throws {
        // Legacy file → load → save → sidecar should appear and main file
        // should no longer carry events.
        let legacyState = makeState(events: [makeEvent(id: "m1")])
        try JSONEncoder.testCacheEncoder.encode(legacyState).write(to: mainFileURL)

        let store = LocalCacheStore(fileURL: mainFileURL)
        let loaded = await store.loadCachedState()
        await store.save(loaded)

        XCTAssertTrue(FileManager.default.fileExists(atPath: eventsFileURL.path),
                      "first save after legacy load must create sidecar")
        let mainData = try Data(contentsOf: mainFileURL)
        let mainDecoded = try JSONDecoder.testCacheDecoder.decode(CachedAppState.self, from: mainData)
        XCTAssertTrue(mainDecoded.events.isEmpty,
                      "main file must drop events after split-on-save")
    }

    // MARK: - Sidecar corruption fallback

    func testCorruptSidecarFallsBackToLegacyEventsInMain() async throws {
        // Simulate: sidecar exists but is junk; main file has legacy events.
        let legacyState = makeState(events: [makeEvent(id: "fallback")])
        try JSONEncoder.testCacheEncoder.encode(legacyState).write(to: mainFileURL)
        try Data("not json".utf8).write(to: eventsFileURL)

        let store = LocalCacheStore(fileURL: mainFileURL)
        let loaded = await store.loadCachedState()

        XCTAssertEqual(loaded.events.count, 1)
        XCTAssertEqual(loaded.events.first?.id, "fallback",
                       "corrupt sidecar must fall back to events embedded in main, not silently drop")
    }

    // MARK: - Encrypted split

    func testEncryptedSidecarRoundtrip() async throws {
        let key = SymmetricKey(size: .bits256)
        let store = LocalCacheStore(fileURL: mainFileURL)
        await store.setEncryptionKey(key)
        let state = makeState(events: [makeEvent(id: "encA"), makeEvent(id: "encB")])
        await store.save(state)

        // Sidecar bytes should not be plaintext-decodable as [CalendarEventMirror]
        // — they're inside the encrypted envelope.
        let raw = try Data(contentsOf: eventsFileURL)
        XCTAssertNil(try? JSONDecoder.testCacheDecoder.decode([CalendarEventMirror].self, from: raw),
                     "encrypted sidecar should not parse as plaintext events array")

        // Fresh store, same key → load decrypts and returns events.
        let reloader = LocalCacheStore(fileURL: mainFileURL)
        await reloader.setEncryptionKey(key)
        let loaded = await reloader.loadCachedState()
        XCTAssertEqual(loaded.events.count, 2)
        XCTAssertEqual(Set(loaded.events.map(\.id)), ["encA", "encB"])
    }

    // MARK: - Hash semantics

    func testHashEventsStableForIdenticalArrays() {
        let events = [makeEvent(id: "a"), makeEvent(id: "b"), makeEvent(id: "c")]
        let h1 = LocalCacheStore.hashEvents(events)
        let h2 = LocalCacheStore.hashEvents(events)
        XCTAssertEqual(h1, h2, "hashing the same events twice must be stable")
    }

    func testHashEventsChangesWhenCountChanges() {
        let h1 = LocalCacheStore.hashEvents([makeEvent(id: "a")])
        let h2 = LocalCacheStore.hashEvents([makeEvent(id: "a"), makeEvent(id: "b")])
        XCTAssertNotEqual(h1, h2)
    }

    func testHashEventsChangesWhenEtagChanges() {
        let h1 = LocalCacheStore.hashEvents([makeEvent(id: "a", etag: "v1")])
        let h2 = LocalCacheStore.hashEvents([makeEvent(id: "a", etag: "v2")])
        XCTAssertNotEqual(h1, h2)
    }

    func testHashEventsChangesWhenIdChanges() {
        let h1 = LocalCacheStore.hashEvents([makeEvent(id: "a")])
        let h2 = LocalCacheStore.hashEvents([makeEvent(id: "b")])
        XCTAssertNotEqual(h1, h2)
    }

    // MARK: - Helpers

    private func sidecarModificationDate() throws -> Date {
        let attrs = try FileManager.default.attributesOfItem(atPath: eventsFileURL.path)
        return try XCTUnwrap(attrs[.modificationDate] as? Date)
    }

    private func makeState(events: [CalendarEventMirror]) -> CachedAppState {
        var state = CachedAppState.empty
        state.events = events
        state.calendars = [
            CalendarListMirror(
                id: "cal-1",
                summary: "Work",
                colorHex: "#0000FF",
                isSelected: true,
                accessRole: "owner",
                etag: nil,
                defaultReminderMinutes: []
            )
        ]
        return state
    }

    private func makeEvent(
        id: String,
        etag: String = "etag-default",
        calendarID: String = "cal-1"
    ) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id,
            calendarID: calendarID,
            summary: "Event \(id)",
            details: "",
            startDate: Date(timeIntervalSince1970: 1_700_000_000),
            endDate: Date(timeIntervalSince1970: 1_700_003_600),
            isAllDay: false,
            status: .confirmed,
            recurrence: [],
            etag: etag,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }
}

private extension JSONDecoder {
    static var testCacheDecoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }
}

private extension JSONEncoder {
    static var testCacheEncoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }
}
