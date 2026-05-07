import AppKit
import XCTest
@testable import MelonPan

@MainActor
final class VimControllerTests: XCTestCase {
    func testCountRepeatsWordMotion() {
        let (textView, controller) = makeController(text: "one two three four five six")

        send("5w", to: controller)

        XCTAssertEqual(textView.selectedRange().location, 24)
    }

    func testZeroStartsLineUnlessItContinuesCount() {
        let (textView, controller) = makeController(text: "zero\none\ntwo\nthree\n")
        textView.setSelectedRange(NSRange(location: 6, length: 0))

        send("0", to: controller)
        XCTAssertEqual(textView.selectedRange().location, 5)

        send("10j", to: controller)
        XCTAssertEqual(textView.selectedRange().location, 13)
    }

    func testCountDeletesMultipleLines() {
        let (textView, controller) = makeController(text: "one\ntwo\nthree\nfour\n")

        send("3dd", to: controller)

        XCTAssertEqual(textView.string, "four\n")
        XCTAssertEqual(textView.selectedRange().location, 0)
    }

    func testCountYanksMultipleLinesForPaste() {
        let (textView, controller) = makeController(text: "one\ntwo\nthree\nfour\n")

        send("2yyp", to: controller)

        XCTAssertEqual(textView.string, "one\none\ntwo\ntwo\nthree\nfour\n")
    }

    func testCountDeletesCharactersForward() {
        let (textView, controller) = makeController(text: "abcdef")

        send("3x", to: controller)

        XCTAssertEqual(textView.string, "def")
    }

    func testDeleteWordMotion() {
        let (textView, controller) = makeController(text: "one two three")

        send("dw", to: controller)

        XCTAssertEqual(textView.string, "two three")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testCountedOperatorWordMotion() {
        let (textView, controller) = makeController(text: "one two three")

        send("d2w", to: controller)

        XCTAssertEqual(textView.string, "three")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testYankWordMotionPastesCapturedText() {
        let (textView, controller) = makeController(text: "one two")

        send("ywGp", to: controller)

        XCTAssertEqual(textView.string, "one twoone ")
    }

    func testChangeWordMotionDeletesAndEntersInsertMode() {
        let (textView, controller) = makeController(text: "one two")

        send("cw", to: controller)

        XCTAssertEqual(textView.string, "two")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
        XCTAssertFalse(controller.isInNormalMode)
    }

    func testDeleteInnerWord() {
        let (textView, controller) = makeController(text: "one two")
        textView.setSelectedRange(NSRange(location: 5, length: 0))

        send("diw", to: controller)

        XCTAssertEqual(textView.string, "one ")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))
    }

    func testYankInnerWordPastesCapturedText() {
        let (textView, controller) = makeController(text: "one two")
        textView.setSelectedRange(NSRange(location: 1, length: 0))

        send("yiwGp", to: controller)

        XCTAssertEqual(textView.string, "one twoone")
    }

    func testChangeInnerWordDeletesAndEntersInsertMode() {
        let (textView, controller) = makeController(text: "one two")
        textView.setSelectedRange(NSRange(location: 1, length: 0))

        send("ciw", to: controller)

        XCTAssertEqual(textView.string, " two")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
        XCTAssertFalse(controller.isInNormalMode)
    }

    func testDeleteInnerQuotes() {
        let (textView, controller) = makeController(text: "say \"hello\" now")
        textView.setSelectedRange(NSRange(location: 6, length: 0))

        send("di\"", to: controller)

        XCTAssertEqual(textView.string, "say \"\" now")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 5, length: 0))
    }

    func testChangeInnerBracketsDeletesAndEntersInsertMode() {
        let (textView, controller) = makeController(text: "foo(bar)baz")
        textView.setSelectedRange(NSRange(location: 5, length: 0))

        send("ci)", to: controller)

        XCTAssertEqual(textView.string, "foo()baz")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))
        XCTAssertFalse(controller.isInNormalMode)
    }

    func testVisualLineDeleteRemovesWholeSelectedLines() {
        let (textView, controller) = makeController(text: "one\ntwo\nthree\nfour\n")
        textView.setSelectedRange(NSRange(location: 5, length: 0))

        send("Vjd", to: controller)

        XCTAssertEqual(textView.string, "one\nfour\n")
        XCTAssertEqual(textView.selectedRange().location, 4)
    }

    func testVisualLineYankPastesLineWise() {
        let (textView, controller) = makeController(text: "one\ntwo\nthree\nfour\n")
        textView.setSelectedRange(NSRange(location: 5, length: 0))

        send("Vjyp", to: controller)

        XCTAssertEqual(textView.string, "one\ntwo\ntwo\nthree\nthree\nfour\n")
    }

    func testForwardSearchPromptSelectsNextMatchAndRepeats() {
        let (textView, controller) = makeController(text: "zero foo bar foo")
        var commandLines: [String?] = []
        controller.onCommandLineChanged = { commandLines.append($0) }

        send("/foo", to: controller)
        XCTAssertEqual(commandLines.compactMap { $0 }, ["/", "/f", "/fo", "/foo"])
        sendEnter(to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 5, length: 3))

        send("n", to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 13, length: 3))

        send("N", to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 5, length: 3))
    }

    func testBackwardSearchPromptSelectsPreviousMatchAndRepeats() {
        let (textView, controller) = makeController(text: "foo bar foo baz")
        textView.setSelectedRange(NSRange(location: textView.string.utf16.count, length: 0))
        var commandLines: [String?] = []
        controller.onCommandLineChanged = { commandLines.append($0) }

        send("?foo", to: controller)
        XCTAssertEqual(commandLines.compactMap { $0 }, ["?", "?f", "?fo", "?foo"])
        sendEnter(to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 8, length: 3))

        send("n", to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 3))

        send("N", to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 8, length: 3))
    }

    func testCommandLineWriteCommandEmitsCallback() {
        let (_, controller) = makeController(text: "draft")
        var commandLines: [String?] = []
        var commands: [VimController.ExCommand] = []
        controller.onCommandLineChanged = { commandLines.append($0) }
        controller.onExCommand = { commands.append($0) }

        send(":w", to: controller)
        XCTAssertEqual(commandLines.compactMap { $0 }, [":", ":w"])

        sendEnter(to: controller)

        XCTAssertEqual(commands, [.write])
        XCTAssertTrue(controller.isInNormalMode)
        XCTAssertNil(commandLines.last ?? nil)
    }

    func testCommandLineQuitWriteQuitAndEditCommandsEmitCallbacks() {
        let (_, controller) = makeController(text: "draft")
        var commands: [VimController.ExCommand] = []
        controller.onExCommand = { commands.append($0) }

        send(":q", to: controller)
        sendEnter(to: controller)
        send(":wq", to: controller)
        sendEnter(to: controller)
        send(":e", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(commands, [.quit, .writeQuit, .edit])
        XCTAssertTrue(controller.isInNormalMode)
    }

    func testCommandLineBackspaceUpdatesBufferAndEscapeCancels() {
        let (_, controller) = makeController(text: "draft")
        var commandLines: [String?] = []
        var commands: [VimController.ExCommand] = []
        controller.onCommandLineChanged = { commandLines.append($0) }
        controller.onExCommand = { commands.append($0) }

        send(":w", to: controller)
        sendBackspace(to: controller)
        XCTAssertEqual(commandLines.compactMap { $0 }.last, ":")

        sendEscape(to: controller)

        XCTAssertTrue(commands.isEmpty)
        XCTAssertTrue(controller.isInNormalMode)
        XCTAssertNil(commandLines.last ?? nil)
    }

    func testSubstituteReplacesFirstMatchOnCurrentLine() {
        let (textView, controller) = makeController(text: "foo foo\nfoo foo\n")

        send(":s/foo/bar/", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.string, "bar foo\nfoo foo\n")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testSubstitutePercentRangeReplacesEveryMatchGlobally() {
        let (textView, controller) = makeController(text: "foo foo\nfoo foo\n")

        send(":%s/foo/bar/g", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.string, "bar bar\nbar bar\n")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testSubstituteNumericRangeReplacesSelectedLinesOnly() {
        let (textView, controller) = makeController(text: "foo\nfoo\nfoo\n")

        send(":2,3s/foo/bar/", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.string, "foo\nbar\nbar\n")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))
    }

    func testSubstituteSymbolicRangeFromCurrentLineToLastLine() {
        let (textView, controller) = makeController(text: "foo\nfoo\nfoo\n")
        textView.setSelectedRange(NSRange(location: 4, length: 0))

        send(":.,$s/foo/bar/", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.string, "foo\nbar\nbar\n")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))
    }

    func testSubstituteSupportsEscapedDelimiterAndCaptureReplacement() {
        let (textView, controller) = makeController(text: "path foo/bar\nname alpha\n")

        send(":%s/\\(foo\\)\\/bar/\\1-baz/", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.string, "path foo-baz\nname alpha\n")
    }

    func testSubstituteEmptyPatternUsesLastSearchPattern() {
        let (textView, controller) = makeController(text: "zero foo\nfoo\n")

        send("/foo", to: controller)
        sendEnter(to: controller)
        send(":%s//bar/", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.string, "zero bar\nbar\n")
    }

    func testStarAndHashSearchWordAtCaret() {
        let (textView, controller) = makeController(text: "foo bar foo")
        textView.setSelectedRange(NSRange(location: 1, length: 0))

        send("*", to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 8, length: 3))

        send("#", to: controller)
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 3))
    }

    func testInvalidRegexSearchDoesNotMoveCaret() {
        let (textView, controller) = makeController(text: "zero foo")
        textView.setSelectedRange(NSRange(location: 2, length: 0))

        send("/(", to: controller)
        sendEnter(to: controller)

        XCTAssertEqual(textView.selectedRange(), NSRange(location: 2, length: 0))
    }

    func testMarkLineJumpMovesToMarkedLineStart() {
        let (textView, controller) = makeController(text: "zero\none\ntwo\n")
        textView.setSelectedRange(NSRange(location: 7, length: 0))

        send("ma", to: controller)
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        send("'a", to: controller)

        XCTAssertEqual(textView.selectedRange(), NSRange(location: 5, length: 0))
    }

    func testMarkExactJumpMovesToStoredOffset() {
        let (textView, controller) = makeController(text: "zero\none\ntwo\n")
        textView.setSelectedRange(NSRange(location: 7, length: 0))

        send("ma", to: controller)
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        send("`a", to: controller)

        XCTAssertEqual(textView.selectedRange(), NSRange(location: 7, length: 0))
    }

    func testMarkJumpClampsAfterDocumentShrinks() {
        let (textView, controller) = makeController(text: "zero\none\ntwo\n")
        textView.setSelectedRange(NSRange(location: 12, length: 0))

        send("ma", to: controller)
        textView.string = "short"
        send("`a", to: controller)

        XCTAssertEqual(textView.selectedRange(), NSRange(location: 5, length: 0))
    }

    func testNamedRegisterLineYankAndPaste() {
        let (textView, controller) = makeController(text: "one\ntwo\nthree\n")

        send("\"ayy", to: controller)
        textView.setSelectedRange(NSRange(location: textView.string.utf16.count, length: 0))
        send("\"ap", to: controller)

        XCTAssertEqual(textView.string, "one\ntwo\nthree\none\n")
    }

    func testNamedRegisterVisualYankAndPaste() {
        let (textView, controller) = makeController(text: "abcdef")
        textView.setSelectedRange(NSRange(location: 1, length: 3))

        send("v\"ay", to: controller)
        textView.setSelectedRange(NSRange(location: 6, length: 0))
        send("\"ap", to: controller)

        XCTAssertEqual(textView.string, "abcdefbcd")
    }

    func testClipboardRegisterPasteReadsPasteboard() {
        let (textView, controller) = makeController(text: "abc")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("XYZ", forType: .string)

        send("\"+p", to: controller)

        XCTAssertEqual(textView.string, "aXYZbc")
    }

    func testClipboardRegisterYankWritesPasteboard() {
        let (textView, controller) = makeController(text: "one\ntwo\n")
        NSPasteboard.general.clearContents()

        send("\"+yy", to: controller)

        XCTAssertEqual(NSPasteboard.general.string(forType: .string), "one\n")
        XCTAssertEqual(textView.string, "one\ntwo\n")
    }

    func testSingleReplaceOverwritesCharacterAndStaysNormal() {
        let (textView, controller) = makeController(text: "abc")
        textView.setSelectedRange(NSRange(location: 1, length: 0))

        send("rZ", to: controller)

        XCTAssertEqual(textView.string, "aZc")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 2, length: 0))
        XCTAssertTrue(controller.isInNormalMode)
    }

    func testReplaceModeOverwritesUntilEscape() {
        let (textView, controller) = makeController(text: "abcdef")
        textView.setSelectedRange(NSRange(location: 2, length: 0))

        send("RXY", to: controller)

        XCTAssertEqual(textView.string, "abXYef")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))

        sendEscape(to: controller)
        XCTAssertTrue(controller.isInNormalMode)
    }

    func testReplaceModeAppendsAtEndOfDocument() {
        let (textView, controller) = makeController(text: "abc")
        textView.setSelectedRange(NSRange(location: 3, length: 0))

        send("RZ", to: controller)

        XCTAssertEqual(textView.string, "abcZ")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))
    }

    func testDotRepeatsCharacterDelete() {
        let (textView, controller) = makeController(text: "abcdef")

        send("x.", to: controller)

        XCTAssertEqual(textView.string, "cdef")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testCountBeforeDotRepeatsChangeMultipleTimes() {
        let (textView, controller) = makeController(text: "abcdef")

        send("x2.", to: controller)

        XCTAssertEqual(textView.string, "def")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testDotRepeatsCountedLineDelete() {
        let (textView, controller) = makeController(text: "one\ntwo\nthree\nfour\n")

        send("2dd.", to: controller)

        XCTAssertEqual(textView.string, "")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 0, length: 0))
    }

    func testDotRepeatsPasteWithCapturedText() {
        let (textView, controller) = makeController(text: "one\ntwo\n")

        send("yyp.", to: controller)

        XCTAssertEqual(textView.string, "one\none\none\ntwo\n")
    }

    func testDotRepeatsSingleReplaceAtNewCaret() {
        let (textView, controller) = makeController(text: "abcde")
        textView.setSelectedRange(NSRange(location: 1, length: 0))

        send("rZl.", to: controller)

        XCTAssertEqual(textView.string, "aZcZe")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 4, length: 0))
    }

    func testDotRepeatsReplaceModeTextAfterEscape() {
        let (textView, controller) = makeController(text: "abcdef")
        textView.setSelectedRange(NSRange(location: 1, length: 0))

        send("RXY", to: controller)
        sendEscape(to: controller)
        send("l.", to: controller)

        XCTAssertEqual(textView.string, "aXYdXY")
        XCTAssertEqual(textView.selectedRange(), NSRange(location: 6, length: 0))
    }

    private func makeController(text: String) -> (NSTextView, VimController) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 300))
        textView.string = text
        textView.isEditable = true
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        let controller = VimController(textView: textView)
        controller.enterNormalMode()
        return (textView, controller)
    }

    private func send(_ keys: String, to controller: VimController) {
        for scalar in keys.unicodeScalars {
            let characters = String(scalar)
            let event = NSEvent.keyEvent(
                with: .keyDown,
                location: .zero,
                modifierFlags: [],
                timestamp: 0,
                windowNumber: 0,
                context: nil,
                characters: characters,
                charactersIgnoringModifiers: characters,
                isARepeat: false,
                keyCode: 0
            )
            XCTAssertTrue(controller.handleKeyDown(event!))
        }
    }

    private func sendEscape(to controller: VimController) {
        let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "\u{1b}",
            charactersIgnoringModifiers: "\u{1b}",
            isARepeat: false,
            keyCode: 53
        )
        XCTAssertTrue(controller.handleKeyDown(event!))
    }

    private func sendEnter(to controller: VimController) {
        let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "\r",
            charactersIgnoringModifiers: "\r",
            isARepeat: false,
            keyCode: 36
        )
        XCTAssertTrue(controller.handleKeyDown(event!))
    }

    private func sendBackspace(to controller: VimController) {
        let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "\u{7f}",
            charactersIgnoringModifiers: "\u{7f}",
            isARepeat: false,
            keyCode: 51
        )
        XCTAssertTrue(controller.handleKeyDown(event!))
    }
}
