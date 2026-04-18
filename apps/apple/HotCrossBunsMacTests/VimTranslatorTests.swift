import XCTest
@testable import HotCrossBunsMac

final class VimTranslatorTests: XCTestCase {
    func testSingleKeysMap() {
        var v = VimTranslator()
        XCTAssertEqual(v.consume("j"), .moveDown)
        XCTAssertEqual(v.consume("k"), .moveUp)
        XCTAssertEqual(v.consume("x"), .toggleComplete)
        XCTAssertEqual(v.consume(":"), .openCommandPalette)
        XCTAssertEqual(v.consume("/"), .focusSearch)
        XCTAssertEqual(v.consume("G"), .scrollBottom)
    }

    func testUnmappedCharReturnsNil() {
        var v = VimTranslator()
        XCTAssertNil(v.consume("q"))
        XCTAssertNil(v.consume("z"))
        XCTAssertNil(v.pending)
    }

    func testGGChord() {
        var v = VimTranslator()
        XCTAssertNil(v.consume("g"))
        XCTAssertEqual(v.pending, "g")
        XCTAssertEqual(v.consume("g"), .scrollTop)
        XCTAssertNil(v.pending)
    }

    func testDDChord() {
        var v = VimTranslator()
        XCTAssertNil(v.consume("d"))
        XCTAssertEqual(v.consume("d"), .deleteSelection)
        XCTAssertNil(v.pending)
    }

    func testChordFollowedByUnrelatedKeyStartsFresh() {
        var v = VimTranslator()
        _ = v.consume("g")
        XCTAssertEqual(v.consume("j"), .moveDown, "g-j should resolve as fresh j")
        XCTAssertNil(v.pending)
    }

    func testChordFollowedByAnotherChordChar() {
        var v = VimTranslator()
        _ = v.consume("g")
        // g-d: not a valid chord; should try consuming d as a fresh key (which begins dd chord)
        XCTAssertNil(v.consume("d"))
        XCTAssertEqual(v.pending, "d")
        XCTAssertEqual(v.consume("d"), .deleteSelection)
    }

    func testResetClearsPending() {
        var v = VimTranslator()
        _ = v.consume("g")
        XCTAssertEqual(v.pending, "g")
        v.reset()
        XCTAssertNil(v.pending)
    }
}
