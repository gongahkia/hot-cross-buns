import CoreSpotlight
import XCTest
@testable import MelonPan

final class MockSpotlightIndex: SpotlightIndexing, @unchecked Sendable {
    private let lock = NSLock()
    private(set) var indexedBatches: [[CSSearchableItem]] = []
    private(set) var deletedDomains: [[String]] = []
    private(set) var deletedIdentifiers: [[String]] = []

    func deleteSearchableItems(withDomainIdentifiers domainIdentifiers: [String]) async throws {
        lock.lock()
        deletedDomains.append(domainIdentifiers)
        lock.unlock()
    }

    func deleteSearchableItems(withIdentifiers identifiers: [String]) async throws {
        lock.lock()
        deletedIdentifiers.append(identifiers)
        lock.unlock()
    }

    func indexSearchableItems(_ items: [CSSearchableItem]) async throws {
        lock.lock()
        indexedBatches.append(items)
        lock.unlock()
    }

    var indexedItems: [CSSearchableItem] {
        lock.lock()
        defer { lock.unlock() }
        return indexedBatches.flatMap { $0 }
    }
}

final class SpotlightIndexerTests: XCTestCase {
    private var tempRoots: [URL] = []

    override func setUp() {
        super.setUp()
        resetDefaults()
    }

    override func tearDown() {
        for root in tempRoots {
            try? FileManager.default.removeItem(at: root)
        }
        tempRoots.removeAll()
        resetDefaults()
        super.tearDown()
    }

    func testBootstrapReindexPopulatesDomain() async throws {
        let root = try makeCache(docs: [
            ("doc-a", "Alpha", "# Alpha\n\nBody A"),
            ("doc-b", "Beta", "# Beta\n\nBody B"),
            ("doc-c", "Gamma", "# Gamma\n\nBody C")
        ])
        let mock = MockSpotlightIndex()
        let indexer = SpotlightIndexer(index: mock)

        await indexer.reindexAll(cacheRoot: root.path)

        XCTAssertEqual(mock.deletedDomains, [[SpotlightIndexer.domain]])
        XCTAssertEqual(mock.indexedItems.count, 3)
        XCTAssertTrue(mock.indexedItems.allSatisfy { $0.domainIdentifier == SpotlightIndexer.domain })
    }

    func testIncrementalUpdateNoopsOnUnchangedContent() async throws {
        let root = try makeCache(docs: [("doc-a", "Alpha", "# Alpha\n\nBody A")])
        let mock = MockSpotlightIndex()
        let indexer = SpotlightIndexer(index: mock)

        await indexer.update(documentId: "doc-a", cacheRoot: root.path)
        await indexer.update(documentId: "doc-a", cacheRoot: root.path)

        XCTAssertEqual(mock.indexedBatches.count, 1)
        XCTAssertEqual(mock.indexedItems.first?.uniqueIdentifier, "melonpan://document/doc-a")
    }

    func testMarkdownStripperRemovesFences() {
        let stripped = MarkdownStripper.strip("# H\n\n```swift\nlet x = 1\n```\n\nbody")

        XCTAssertTrue(stripped.starts(with: "H"))
        XCTAssertTrue(stripped.contains("body"))
        XCTAssertFalse(stripped.contains("swift"))
        XCTAssertFalse(stripped.contains("`"))
    }

    func testHeadingKeywords() {
        let keywords = MarkdownStripper.keywords("# Alpha\n## Beta\n\nSetext\n---\n\nbody #foo")

        XCTAssertTrue(keywords.contains("alpha"))
        XCTAssertTrue(keywords.contains("beta"))
        XCTAssertTrue(keywords.contains("setext"))
        XCTAssertTrue(keywords.contains("foo"))
    }

    func testSpotlightIdentifierDecodesDocument() {
        XCTAssertEqual(
            SpotlightIdentifier(uniqueIdentifier: "melonpan://document/abc123"),
            .document("abc123")
        )
        XCTAssertNil(SpotlightIdentifier(uniqueIdentifier: "hotcrossbuns://task/abc123"))
    }

    func testDisabledIndexingNoops() async throws {
        UserDefaults.standard.set(false, forKey: SpotlightIndexer.indexingEnabledKey)
        let root = try makeCache(docs: [("doc-a", "Alpha", "# Alpha")])
        let mock = MockSpotlightIndex()
        let indexer = SpotlightIndexer(index: mock)

        await indexer.reindexAll(cacheRoot: root.path)
        await indexer.update(documentId: "doc-a", cacheRoot: root.path)

        XCTAssertTrue(mock.indexedBatches.isEmpty)
        XCTAssertTrue(mock.deletedDomains.isEmpty)
    }

    func testRemoveAllClearsDomain() async {
        let mock = MockSpotlightIndex()
        let indexer = SpotlightIndexer(index: mock)

        await indexer.removeAll()

        XCTAssertEqual(mock.deletedDomains, [[SpotlightIndexer.domain]])
    }

    private func resetDefaults() {
        UserDefaults.standard.removeObject(forKey: SpotlightIndexer.indexingEnabledKey)
        UserDefaults.standard.removeObject(forKey: SpotlightIndexer.lastFullReindexKey)
        UserDefaults.standard.removeObject(forKey: SpotlightIndexer.lastIndexedDocCountKey)
    }

    private func makeCache(docs: [(id: String, title: String, markdown: String)]) throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-spotlight-\(UUID().uuidString)")
        tempRoots.append(root)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("docs"),
            withIntermediateDirectories: true
        )
        for doc in docs {
            let docRoot = root.appendingPathComponent("docs").appendingPathComponent(doc.id)
            try FileManager.default.createDirectory(at: docRoot, withIntermediateDirectories: true)
            try doc.markdown.write(
                to: docRoot.appendingPathComponent("current.md"),
                atomically: true,
                encoding: .utf8
            )
            try docsJSON(id: doc.id, title: doc.title).write(
                to: docRoot.appendingPathComponent("current.docs.json"),
                atomically: true,
                encoding: .utf8
            )
            try metaJSON(id: doc.id).write(
                to: docRoot.appendingPathComponent("meta.json"),
                atomically: true,
                encoding: .utf8
            )
        }
        return root
    }

    private func docsJSON(id: String, title: String) -> String {
        """
        {"documentId":"\(id)","title":"\(title)","revisionId":"rev-\(id)","body":{"content":[{"startIndex":1,"endIndex":6}]}}
        """
    }

    private func metaJSON(id: String) -> String {
        """
        {"documentId":"\(id)","revisionId":"rev-\(id)","driveModifiedTime":"2026-05-01T00:00:00Z","mdHash":"fixture","docsJsonHash":"fixture","lastPulledAt":"2026-05-01T00:00:01Z","lastPushedAt":null,"lastFidelityReport":{"score":100,"warnings":[]}}
        """
    }
}
