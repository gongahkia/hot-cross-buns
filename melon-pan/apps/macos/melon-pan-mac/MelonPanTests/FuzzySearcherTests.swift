import XCTest
@testable import MelonPan

final class FuzzySearcherTests: XCTestCase {
    func testPrefixOutranksSubstring() {
        let labels = ["Open Drive", "Diagnostics", "New Local Draft"]
        let results = FuzzySearcher.rank(
            labels,
            query: "dri",
            labelForItem: { $0 },
            limit: 10
        )
        XCTAssertEqual(results.first?.item, "Open Drive")
    }

    func testWordStartOutranksMidword() {
        let labels = ["Foo Drive", "Archivedrive"]
        let results = FuzzySearcher.rank(
            labels,
            query: "dri",
            labelForItem: { $0 },
            limit: 10
        )
        XCTAssertEqual(results.first?.item, "Foo Drive")
    }

    func testFullMatchWins() {
        let labels = ["Open Drive", "Drive", "Drive Tree"]
        let results = FuzzySearcher.rank(
            labels,
            query: "drive",
            labelForItem: { $0 },
            limit: 10
        )
        XCTAssertEqual(results.first?.item, "Drive")
    }

    func testNonSubsequenceReturnsNil() {
        XCTAssertNil(FuzzySearcher.match(label: "abc", keywords: [], query: "z"))
    }

    func testConsecutiveBonusGrows() {
        let compact = FuzzySearcher.match(label: "abcd", keywords: [], query: "abcd")
        let spread = FuzzySearcher.match(label: "axbycdz", keywords: [], query: "abcd")
        XCTAssertGreaterThan(compact?.score ?? 0, spread?.score ?? 0)
    }
}
