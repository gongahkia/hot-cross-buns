import XCTest
@testable import HotCrossBunsMac

final class TagExtractorTests: XCTestCase {
    func testExtractsSingleTag() {
        XCTAssertEqual(TagExtractor.tags(in: "Pay rent #personal"), ["personal"])
    }

    func testExtractsMultipleTags() {
        XCTAssertEqual(TagExtractor.tags(in: "Review PR #work #urgent"), ["work", "urgent"])
    }

    func testIgnoresUnmatchedHashes() {
        XCTAssertEqual(TagExtractor.tags(in: "Use # alone"), [])
        XCTAssertEqual(TagExtractor.tags(in: "C# tutorial"), [])
    }

    func testSupportsHyphenAndUnderscore() {
        XCTAssertEqual(TagExtractor.tags(in: "task #side_project-v2"), ["side_project-v2"])
    }

    func testStrippedRemovesTagsAndCollapsesSpaces() {
        XCTAssertEqual(TagExtractor.stripped(from: "Pay rent #personal #urgent"), "Pay rent")
        XCTAssertEqual(TagExtractor.stripped(from: "#work Review PR"), "Review PR")
    }

    func testStrippedPreservesTextWithoutTags() {
        XCTAssertEqual(TagExtractor.stripped(from: "Write blog post"), "Write blog post")
    }
}
