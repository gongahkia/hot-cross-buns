import XCTest
@testable import HotCrossBunsMac

final class FuzzySearcherTests: XCTestCase {
    // MARK: - match / score

    func testEmptyQueryMatchesWithZeroScore() {
        let m = FuzzySearcher.match(label: "Anything", query: "")
        XCTAssertNotNil(m)
        XCTAssertEqual(m?.score, 0)
    }

    func testExactMatchScoresHighest() {
        let exact = FuzzySearcher.match(label: "refresh", query: "refresh")!
        let prefix = FuzzySearcher.match(label: "refresh sync", query: "refresh")!
        let fuzzy = FuzzySearcher.match(label: "my refresh thingy", query: "refresh")!
        XCTAssertGreaterThan(exact.score, prefix.score)
        XCTAssertGreaterThan(prefix.score, fuzzy.score)
    }

    func testNonSubsequenceReturnsNil() {
        XCTAssertNil(FuzzySearcher.match(label: "Hello world", query: "zzz"))
    }

    func testCaseInsensitive() {
        XCTAssertNotNil(FuzzySearcher.match(label: "Refresh Sync", query: "REFRESH"))
        XCTAssertNotNil(FuzzySearcher.match(label: "REFRESH SYNC", query: "refresh"))
    }

    func testWordStartOutranksMidWord() {
        // "nt" matches New Task (word start of Task) and Snoring Theatrics (mid-word).
        let wordStart = FuzzySearcher.match(label: "New Task", query: "nt")!
        let midWord = FuzzySearcher.match(label: "Snoring Theatrics", query: "nt")!
        XCTAssertGreaterThan(wordStart.score, midWord.score)
    }

    func testConsecutiveMatchBonus() {
        let consecutive = FuzzySearcher.match(label: "buy milk", query: "buy")!
        let scattered = FuzzySearcher.match(label: "b u y", query: "buy")!
        XCTAssertGreaterThan(consecutive.score, scattered.score)
    }

    func testKeywordsAreConsulted() {
        // Label alone doesn't contain 'sync', but the keyword does.
        let m = FuzzySearcher.match(label: "Refresh", keywords: ["sync", "reload"], query: "sync")
        XCTAssertNotNil(m)
    }

    func testHighlightRangesCoverMatches() {
        let m = FuzzySearcher.match(label: "refresh sync", query: "rsh")!
        let matched = m.matchedRanges.map { "refresh sync"[$0] }.joined()
        XCTAssertEqual(String(matched), "rsh")
    }

    // MARK: - rank

    func testRankReturnsHighestScoringFirst() {
        let labels = ["New Task", "Refresh Sync", "Open Diagnostics", "Force Full Resync"]
        let result = FuzzySearcher.rank(labels, query: "refresh", labelForItem: { $0 })
        XCTAssertEqual(result.first?.item, "Refresh Sync")
    }

    func testRankDropsNonMatches() {
        let labels = ["alpha", "beta", "gamma"]
        let result = FuzzySearcher.rank(labels, query: "zzz", labelForItem: { $0 })
        XCTAssertTrue(result.isEmpty)
    }

    func testRankHonorsLimit() {
        let many = (1...100).map { "item\($0)" }
        let result = FuzzySearcher.rank(many, query: "item", labelForItem: { $0 }, limit: 5)
        XCTAssertEqual(result.count, 5)
    }

    func testRankWithEmptyQueryReturnsPrefix() {
        let labels = ["a", "b", "c", "d", "e"]
        let result = FuzzySearcher.rank(labels, query: "", labelForItem: { $0 }, limit: 3)
        XCTAssertEqual(result.map(\.item), ["a", "b", "c"])
    }

    func testRankUsesKeywordsForFallback() {
        struct Cmd { let title: String; let keywords: [String] }
        let cmds = [
            Cmd(title: "Refresh", keywords: ["sync", "reload"]),
            Cmd(title: "Compile", keywords: [])
        ]
        let result = FuzzySearcher.rank(
            cmds,
            query: "sync",
            labelForItem: { $0.title },
            keywordsForItem: { $0.keywords }
        )
        XCTAssertEqual(result.first?.item.title, "Refresh")
    }
}
