import XCTest

final class CommandPaletteTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    func testCmdPOpensPalette() {
        openPalette()
        XCTAssertTrue(paletteMarker.waitForExistence(timeout: 2))
    }

    func testEscCloses() {
        openPalette()
        XCTAssertTrue(paletteMarker.waitForExistence(timeout: 2))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertFalse(paletteMarker.waitForExistence(timeout: 1))
    }

    func testTypingDriveFiltersToOpenDriveFirst() {
        openPalette()
        app.typeText("drive")
        XCTAssertTrue(app.buttons["Open Drive"].waitForExistence(timeout: 2))
    }

    func testEnterExecutesTopMatchAndSwitchesPane() {
        openPalette()
        app.typeText("drive")
        app.typeKey(.return, modifierFlags: [])
        XCTAssertFalse(app.windows["Command Palette"].waitForExistence(timeout: 1))
        XCTAssertTrue(app.staticTexts["Drive"].waitForExistence(timeout: 2))
    }

    func testCmd1OpensFirstResult() {
        openPalette()
        app.typeText("drive")
        app.typeKey("1", modifierFlags: .command)
        XCTAssertFalse(app.windows["Command Palette"].waitForExistence(timeout: 1))
        XCTAssertTrue(app.staticTexts["Drive"].waitForExistence(timeout: 2))
    }

    private func openPalette() {
        app.typeKey("p", modifierFlags: .command)
    }

    private var paletteMarker: XCUIElement {
        app.buttons["Open Drive"]
    }
}
