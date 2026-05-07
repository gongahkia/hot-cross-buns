import AppKit

/// Tiny Vim-mode state machine bolted onto `MelonPanTextView`.
///
/// Scope (V1, deliberately narrow):
///   modes:    normal / insert / visual-character
///   motions:  h j k l 0 $ w b gg G
///   enter:    i a I A o O  (move to insert mode)
///   edit:     x  dd  yy  p  u  ESC
///   visual:   v / V  →  d / y / c
///   counts:   numeric prefixes for motions and line edits (`5w`, `3dd`)
///   search:   / ? n N * #
///   marks:    m{letter}, '{letter}, `{letter}
///   registers: "{letter}y / "{letter}p, "+ for NSPasteboard
///   replace:  r{char}, R
///   repeat:   . for recent Vim-controller write ops
///   objects:  dw/yw/cw, diw/yiw/ciw, quoted/bracketed inner objects
///   ex:       :w, :q, :wq, :x, :s
///
/// Out of scope: Vim-style undo trees, visual-block, Ctrl bindings.
///
/// The controller does not own the storage — it asks the host
/// `NSTextView` to perform standard AppKit edits (delete, paste,
/// move-cursor, etc.). That keeps Vim mode compatible with the existing
/// rich-edit capture: every Vim-driven mutation goes through
/// NSTextStorageDelegate the same as any other typed character.
final class VimController {
    enum Mode {
        case normal
        case insert
        case visualCharacter
        case visualLine
        case replace
        case commandLine
    }

    enum ExCommand: Equatable {
        case write
        case quit
        case writeQuit
        case edit
    }

    enum SearchDirection {
        case forward
        case backward

        var reversed: SearchDirection {
            switch self {
            case .forward: return .backward
            case .backward: return .forward
            }
        }
    }

    private enum TextObjectScope {
        case inner
        case around
    }

    private enum CommandLineKind {
        case ex
        case search(SearchDirection)
    }

    private struct SubstitutionCommand {
        let range: String?
        let pattern: String
        let replacement: String
        let isGlobal: Bool
    }

    private struct LineEntry {
        let fullRange: NSRange
        let contentRange: NSRange
    }

    private enum RepeatableChange {
        case deleteCharactersForward(Int)
        case deleteCurrentLine(Int)
        case deleteWordMotion(Int)
        case deleteTextObject(TextObjectScope, Character, Int)
        case pasteAfterCaret(String)
        case replaceText(String)
    }

    private(set) var mode: Mode = .insert
    private weak var textView: NSTextView?
    var onExCommand: ((ExCommand) -> Void)?
    var onCommandLineChanged: ((String?) -> Void)?
    /// Tracks the start of the current visual selection so the storage
    /// can be highlighted as the user moves the caret. Set on entry,
    /// cleared on exit.
    private var visualAnchor: Int? = nil
    /// Current moving end of the visual selection. NSTextView stores
    /// selections as sorted ranges, so keep this separately to support
    /// extending back across the anchor.
    private var visualFocus: Int? = nil
    /// One-letter operator buffer for two-keystroke commands (`dd`,
    /// `yy`, `gg`). nil when no operator is pending.
    private var pendingOperator: Character? = nil
    /// Count prefix collected before the current command (`3dd`, `5w`).
    private var pendingCount: Int = 0
    private var hasPendingCount: Bool = false
    /// Count captured before an operator while waiting for its second key.
    private var pendingOperatorCount: Int = 1
    private var pendingTextObjectScope: TextObjectScope? = nil
    private var pendingMarkCommand: Character? = nil
    private var pendingRegister: Character? = nil
    private var activeRegister: Character? = nil
    private var isPendingSingleReplace: Bool = false
    /// Unnamed yank buffer plus lightweight named registers.
    private var yankBuffer: String = ""
    private var registers: [Character: String] = [:]
    private var lastSearchPattern: String?
    private var lastSearchDirection: SearchDirection = .forward
    private var marks: [Character: Int] = [:]
    private var lastChange: RepeatableChange?
    private var currentReplaceText: String = ""
    private var commandLineBuffer: String = ""
    private var commandLineKind: CommandLineKind = .ex
    private var isReplayingChange: Bool = false

    init(textView: NSTextView) {
        self.textView = textView
    }

    var isInNormalMode: Bool { mode == .normal }

    /// Returns true when the controller swallowed the event. Caller
    /// should NOT forward to NSTextView when this returns true.
    func handleKeyDown(_ event: NSEvent) -> Bool {
        guard let textView else { return false }
        // ESC always returns to normal mode.
        if event.keyCode == 53 { // 53 = Escape
            if mode == .replace, !currentReplaceText.isEmpty {
                recordChange(.replaceText(currentReplaceText))
            }
            enterNormalMode()
            return true
        }
        switch mode {
        case .insert:
            return false
        case .normal:
            return handleNormalMode(event, textView: textView)
        case .visualCharacter:
            return handleVisualMode(event, textView: textView)
        case .visualLine:
            return handleVisualLineMode(event, textView: textView)
        case .replace:
            return handleReplaceMode(event, textView: textView)
        case .commandLine:
            return handleCommandLineMode(event, textView: textView)
        }
    }

    // MARK: - Normal mode

    private func handleNormalMode(_ event: NSEvent, textView: NSTextView) -> Bool {
        guard let chars = event.charactersIgnoringModifiers else { return true }
        for ch in chars {
            handleNormalCharacter(ch, textView: textView)
        }
        return true
    }

    private func handleNormalCharacter(_ ch: Character, textView: NSTextView) {
        if handlePendingTextObjectIfNeeded(ch, textView: textView) {
            return
        }

        if handlePendingMarkCommandIfNeeded(ch, textView: textView) {
            return
        }

        if handlePendingRegisterIfNeeded(ch) {
            return
        }

        if handlePendingSingleReplaceIfNeeded(ch, textView: textView) {
            return
        }

        if accumulateCountIfNeeded(ch) {
            return
        }

        // Operator pending? Resolve doubled-letter commands, motions, and text-object prefixes.
        if let pending = pendingOperator {
            let count = pendingOperatorCount * consumeCount()
            switch (pending, ch) {
            case ("d", "d"):
                pendingOperator = nil
                if deleteCurrentLine(count: count, textView: textView) {
                    recordChange(.deleteCurrentLine(count))
                }
                activeRegister = nil
                return
            case ("y", "y"):
                pendingOperator = nil
                yankCurrentLine(count: count, textView: textView)
                activeRegister = nil
                return
            case ("g", "g"):
                pendingOperator = nil
                moveCaretToDocumentStart(textView: textView)
                activeRegister = nil
                return
            case ("d", "w"), ("y", "w"), ("c", "w"):
                pendingOperator = nil
                applyWordMotionOperator(pending, count: count, textView: textView)
                activeRegister = nil
                return
            case ("d", "i"), ("y", "i"), ("c", "i"):
                pendingTextObjectScope = .inner
                pendingOperatorCount = count
                return
            case ("d", "a"), ("y", "a"), ("c", "a"):
                pendingTextObjectScope = .around
                pendingOperatorCount = count
                return
            default:
                // Pending operator + a different character: drop the
                // operator and fall through so the new char is treated
                // as a fresh command.
                pendingOperator = nil
                pendingOperatorCount = 1
                break
            }
        }

        switch ch {
        case "h":
            repeatCommand { moveCaret(by: -1, textView: textView) }
        case "l":
            repeatCommand { moveCaret(by: 1, textView: textView) }
        case "j":
            repeatCommand { moveCaretLine(delta: 1, textView: textView) }
        case "k":
            repeatCommand { moveCaretLine(delta: -1, textView: textView) }
        case "0":
            moveCaretToLineStart(textView: textView)
            resetPendingCount()
        case "$":
            moveCaretToLineEnd(textView: textView)
            resetPendingCount()
        case "w":
            repeatCommand { moveCaretWord(forward: true, textView: textView) }
        case "b":
            repeatCommand { moveCaretWord(forward: false, textView: textView) }
        case "G":
            moveCaretToDocumentEnd(textView: textView)
            resetPendingCount()
        case "g":
            pendingOperator = "g"
            pendingOperatorCount = consumeCount()
        case "i":
            mode = .insert
            resetPendingCount()
        case "a":
            repeatCommand { moveCaret(by: 1, textView: textView) }
            mode = .insert
        case "I":
            moveCaretToLineStart(textView: textView)
            mode = .insert
            resetPendingCount()
        case "A":
            moveCaretToLineEnd(textView: textView)
            mode = .insert
            resetPendingCount()
        case "o":
            moveCaretToLineEnd(textView: textView)
            repeatCommand { insertNewline(textView: textView) }
            mode = .insert
        case "O":
            moveCaretToLineStart(textView: textView)
            repeatCommand {
                insertNewline(textView: textView)
                moveCaret(by: -1, textView: textView)
            }
            mode = .insert
        case "x":
            let count = consumeCount()
            if deleteCharForward(count: count, textView: textView) {
                recordChange(.deleteCharactersForward(count))
            }
        case "d":
            pendingOperator = "d"
            pendingOperatorCount = consumeCount()
        case "y":
            pendingOperator = "y"
            pendingOperatorCount = consumeCount()
        case "c":
            pendingOperator = "c"
            pendingOperatorCount = consumeCount()
        case "p":
            let count = consumeCount()
            for _ in 0..<count {
                let text = textForPaste()
                if pasteAfterCaret(text, textView: textView) {
                    recordChange(.pasteAfterCaret(text))
                }
            }
            activeRegister = nil
        case "u":
            repeatCommand { textView.undoManager?.undo() }
        case ".":
            let count = consumeCount()
            repeatLastChange(count: count, textView: textView)
        case "r":
            isPendingSingleReplace = true
            resetPendingCount()
        case "R":
            mode = .replace
            currentReplaceText = ""
            resetPendingCount()
        case "v":
            mode = .visualCharacter
            visualAnchor = textView.selectedRange().location
            visualFocus = visualAnchor
            resetPendingCount()
        case "V":
            enterVisualLineMode(textView: textView)
            resetPendingCount()
        case "/":
            enterCommandLineMode(kind: .search(.forward))
            resetPendingCount()
        case "?":
            enterCommandLineMode(kind: .search(.backward))
            resetPendingCount()
        case "n":
            repeatSearch(direction: lastSearchDirection, textView: textView)
            resetPendingCount()
        case "N":
            repeatSearch(direction: lastSearchDirection.reversed, textView: textView)
            resetPendingCount()
        case "*":
            searchWordAtCaret(direction: .forward, textView: textView)
            resetPendingCount()
        case "#":
            searchWordAtCaret(direction: .backward, textView: textView)
            resetPendingCount()
        case ":":
            enterCommandLineMode(kind: .ex)
        case "m", "'", "`":
            pendingMarkCommand = ch
            resetPendingCount()
        case "\"":
            pendingRegister = ch
            resetPendingCount()
        default:
            // Unhandled — silently swallow so the user doesn't insert
            // accidental characters while in normal mode.
            activeRegister = nil
            isPendingSingleReplace = false
            resetPendingCount()
            break
        }
    }

    private func handlePendingTextObjectIfNeeded(_ ch: Character, textView: NSTextView) -> Bool {
        guard let pending = pendingOperator, let scope = pendingTextObjectScope else { return false }
        let count = pendingOperatorCount * consumeCount()
        pendingOperator = nil
        pendingOperatorCount = 1
        pendingTextObjectScope = nil
        applyTextObjectOperator(pending, scope: scope, object: ch, count: count, textView: textView)
        activeRegister = nil
        return true
    }

    private func handlePendingMarkCommandIfNeeded(_ ch: Character, textView: NSTextView) -> Bool {
        if let command = pendingMarkCommand {
            pendingMarkCommand = nil
            handleMarkCommand(command, mark: ch, textView: textView)
            return true
        }
        return false
    }

    private func handlePendingRegisterIfNeeded(_ ch: Character) -> Bool {
        if pendingRegister == "\"" {
            pendingRegister = nil
            if isValidRegister(ch) {
                activeRegister = ch
            }
            return true
        }
        return false
    }

    private func handlePendingSingleReplaceIfNeeded(_ ch: Character, textView: NSTextView) -> Bool {
        guard isPendingSingleReplace else { return false }
        isPendingSingleReplace = false
        let text = String(ch)
        if replaceCharacter(with: text, textView: textView) {
            recordChange(.replaceText(text))
        }
        return true
    }

    // MARK: - Visual mode

    private func handleVisualMode(_ event: NSEvent, textView: NSTextView) -> Bool {
        guard let chars = event.charactersIgnoringModifiers else { return true }
        for ch in chars {
            handleVisualCharacter(ch, textView: textView)
        }
        return true
    }

    private func handleVisualCharacter(_ ch: Character, textView: NSTextView) {
        if handlePendingRegisterIfNeeded(ch) {
            return
        }

        if accumulateCountIfNeeded(ch) {
            return
        }

        switch ch {
        case "h":
            repeatCommand { extendSelection(by: -1, textView: textView) }
        case "l":
            repeatCommand { extendSelection(by: 1, textView: textView) }
        case "j":
            repeatCommand { extendSelectionLine(delta: 1, textView: textView) }
        case "k":
            repeatCommand { extendSelectionLine(delta: -1, textView: textView) }
        case "0":
            extendSelectionToLineStart(textView: textView)
            resetPendingCount()
        case "$":
            extendSelectionToLineEnd(textView: textView)
            resetPendingCount()
        case "d", "x":
            deleteSelection(textView: textView)
            enterNormalMode()
        case "y":
            yankSelection(textView: textView)
            enterNormalMode()
        case "c":
            deleteSelection(textView: textView)
            mode = .insert
            activeRegister = nil
            resetPendingCount()
        case "\"":
            pendingRegister = ch
            resetPendingCount()
        default:
            activeRegister = nil
            resetPendingCount()
            break
        }
    }

    private func handleVisualLineMode(_ event: NSEvent, textView: NSTextView) -> Bool {
        guard let chars = event.charactersIgnoringModifiers else { return true }
        for ch in chars {
            handleVisualLineCharacter(ch, textView: textView)
        }
        return true
    }

    private func handleReplaceMode(_ event: NSEvent, textView: NSTextView) -> Bool {
        guard let chars = event.charactersIgnoringModifiers else { return true }
        for ch in chars {
            let text = String(ch)
            if replaceCharacter(with: text, textView: textView) {
                currentReplaceText += text
            }
        }
        return true
    }

    private func handleVisualLineCharacter(_ ch: Character, textView: NSTextView) {
        if handlePendingRegisterIfNeeded(ch) {
            return
        }

        if accumulateCountIfNeeded(ch) {
            return
        }

        switch ch {
        case "j":
            repeatCommand { extendVisualLine(delta: 1, textView: textView) }
        case "k":
            repeatCommand { extendVisualLine(delta: -1, textView: textView) }
        case "d", "x":
            deleteSelection(textView: textView)
            enterNormalMode()
        case "y":
            yankSelection(textView: textView)
            enterNormalMode()
        case "c":
            deleteSelection(textView: textView)
            mode = .insert
            activeRegister = nil
            resetPendingCount()
        case "\"":
            pendingRegister = ch
            resetPendingCount()
        default:
            activeRegister = nil
            resetPendingCount()
            break
        }
    }

    // MARK: - Command-line mode

    private func handleCommandLineMode(_ event: NSEvent, textView: NSTextView) -> Bool {
        if event.keyCode == 36 || event.keyCode == 76 {
            executeCommandLine(textView: textView)
            return true
        }
        if event.keyCode == 51 {
            if !commandLineBuffer.isEmpty {
                commandLineBuffer.removeLast()
                emitCommandLine()
            }
            return true
        }

        guard let chars = event.charactersIgnoringModifiers else { return true }
        for ch in chars where !ch.isNewline {
            commandLineBuffer.append(ch)
        }
        emitCommandLine()
        return true
    }

    private func enterCommandLineMode(kind: CommandLineKind) {
        mode = .commandLine
        commandLineKind = kind
        commandLineBuffer = ""
        resetPendingCount()
        emitCommandLine()
    }

    private func executeCommandLine(textView: NSTextView) {
        let command = commandLineBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
        let kind = commandLineKind
        enterNormalMode()
        guard !command.isEmpty else { return }

        switch kind {
        case .ex:
            if performSubstitution(command: command, textView: textView) {
                return
            }
            switch command {
            case "w", "write":
                onExCommand?(.write)
            case "q", "quit":
                onExCommand?(.quit)
            case "wq", "x":
                onExCommand?(.writeQuit)
            case "e", "edit":
                onExCommand?(.edit)
            default:
                break
            }
        case .search(let direction):
            lastSearchPattern = command
            lastSearchDirection = direction
            search(pattern: command, direction: direction, textView: textView)
        }
    }

    private func emitCommandLine() {
        onCommandLineChanged?("\(commandLinePrefix)\(commandLineBuffer)")
    }

    private var commandLinePrefix: String {
        switch commandLineKind {
        case .ex:
            return ":"
        case .search(.forward):
            return "/"
        case .search(.backward):
            return "?"
        }
    }

    private func accumulateCountIfNeeded(_ ch: Character) -> Bool {
        guard ch >= "0", ch <= "9" else { return false }
        if ch == "0", !hasPendingCount {
            return false
        }
        hasPendingCount = true
        let digit = ch.wholeNumberValue ?? 0
        pendingCount = min((pendingCount * 10) + digit, 9999)
        return true
    }

    private func consumeCount(default defaultCount: Int = 1) -> Int {
        defer { resetPendingCount() }
        guard hasPendingCount else { return defaultCount }
        return max(1, pendingCount)
    }

    private func resetPendingCount() {
        pendingCount = 0
        hasPendingCount = false
    }

    private func repeatCommand(_ body: () -> Void) {
        let count = consumeCount()
        for _ in 0..<count {
            body()
        }
    }

    // MARK: - Dot repeat

    private func recordChange(_ change: RepeatableChange) {
        guard !isReplayingChange else { return }
        lastChange = change
    }

    private func repeatLastChange(count: Int, textView: NSTextView) {
        guard let lastChange else { return }
        isReplayingChange = true
        defer { isReplayingChange = false }

        for _ in 0..<max(1, count) {
            switch lastChange {
            case .deleteCharactersForward(let changeCount):
                _ = deleteCharForward(count: changeCount, textView: textView)
            case .deleteCurrentLine(let changeCount):
                _ = deleteCurrentLine(count: changeCount, textView: textView)
            case .deleteWordMotion(let changeCount):
                applyWordMotionOperator("d", count: changeCount, textView: textView)
            case .deleteTextObject(let scope, let object, let changeCount):
                applyTextObjectOperator("d", scope: scope, object: object, count: changeCount, textView: textView)
            case .pasteAfterCaret(let text):
                _ = pasteAfterCaret(text, textView: textView)
            case .replaceText(let text):
                replaceText(text, textView: textView)
            }
        }
    }

    // MARK: - Operators and text objects

    private func applyWordMotionOperator(_ operatorCommand: Character, count: Int, textView: NSTextView) {
        let nsString = textView.string as NSString
        let location = textView.selectedRange().location
        guard let range = wordMotionRange(count: count, in: nsString, from: location) else { return }
        applyOperator(operatorCommand, to: range, textView: textView)
        if operatorCommand == "d" {
            recordChange(.deleteWordMotion(count))
        }
    }

    private func applyTextObjectOperator(
        _ operatorCommand: Character,
        scope: TextObjectScope,
        object: Character,
        count: Int,
        textView: NSTextView
    ) {
        let nsString = textView.string as NSString
        let location = textView.selectedRange().location
        guard let range = textObjectRange(scope: scope, object: object, count: count, in: nsString, at: location) else {
            return
        }
        applyOperator(operatorCommand, to: range, textView: textView)
        if operatorCommand == "d" {
            recordChange(.deleteTextObject(scope, object, count))
        }
    }

    @discardableResult
    private func applyOperator(_ operatorCommand: Character, to range: NSRange, textView: NSTextView) -> Bool {
        guard range.length > 0 else { return false }
        switch operatorCommand {
        case "d":
            return deleteRange(range, textView: textView)
        case "y":
            storeYank((textView.string as NSString).substring(with: range))
            return true
        case "c":
            guard deleteRange(range, textView: textView) else { return false }
            mode = .insert
            return true
        default:
            return false
        }
    }

    private func wordMotionRange(count: Int, in nsString: NSString, from location: Int) -> NSRange? {
        guard nsString.length > 0 else { return nil }
        let start = min(max(0, location), nsString.length)
        var end = start
        for _ in 0..<max(1, count) {
            end = nextWordStart(in: nsString, from: end)
        }
        guard end > start else { return nil }
        return NSRange(location: start, length: end - start)
    }

    private func textObjectRange(
        scope: TextObjectScope,
        object: Character,
        count: Int,
        in nsString: NSString,
        at location: Int
    ) -> NSRange? {
        if object == "w" {
            guard let word = wordRange(at: location, in: nsString) else { return nil }
            return scope == .inner ? word : aroundWordRange(word, in: nsString)
        }

        if isQuoteObject(object) {
            return quotedRange(scope: scope, quote: object, in: nsString, at: location)
        }

        guard let pair = bracketPair(for: object) else { return nil }
        return bracketedRange(scope: scope, open: pair.open, close: pair.close, count: count, in: nsString, at: location)
    }

    private func replaceText(_ text: String, textView: NSTextView) {
        for ch in text {
            _ = replaceCharacter(with: String(ch), textView: textView)
        }
    }

    // MARK: - Registers

    private func isValidRegister(_ ch: Character) -> Bool {
        ch == "+" || ch == "\"" || ch.isLetter
    }

    private func storeYank(_ text: String) {
        yankBuffer = text
        if let register = activeRegister {
            store(text, in: register)
        }
    }

    private func store(_ text: String, in register: Character) {
        if register == "+" {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
        } else if register != "\"" {
            registers[register] = text
        }
    }

    private func textForPaste() -> String {
        guard let register = activeRegister else { return yankBuffer }
        if register == "+" {
            return NSPasteboard.general.string(forType: .string) ?? ""
        }
        if register == "\"" {
            return yankBuffer
        }
        return registers[register] ?? ""
    }

    // MARK: - Marks

    private func handleMarkCommand(_ command: Character, mark: Character, textView: NSTextView) {
        guard mark.isLetter else { return }
        switch command {
        case "m":
            marks[mark] = textView.selectedRange().location
        case "'":
            guard let location = marks[mark] else { return }
            jumpToMark(location, exact: false, textView: textView)
        case "`":
            guard let location = marks[mark] else { return }
            jumpToMark(location, exact: true, textView: textView)
        default:
            break
        }
    }

    private func jumpToMark(_ location: Int, exact: Bool, textView: NSTextView) {
        let length = textView.textStorage?.length ?? textView.string.utf16.count
        let clamped = max(0, min(location, length))
        if exact {
            textView.setSelectedRange(NSRange(location: clamped, length: 0))
            return
        }

        let nsString = textView.string as NSString
        if nsString.length == 0 {
            textView.setSelectedRange(NSRange(location: 0, length: 0))
            return
        }
        let lineLocation = min(clamped, nsString.length - 1)
        let line = nsString.lineRange(for: NSRange(location: lineLocation, length: 0))
        textView.setSelectedRange(NSRange(location: line.location, length: 0))
    }

    // MARK: - Search

    private func repeatSearch(direction: SearchDirection, textView: NSTextView) {
        guard let pattern = lastSearchPattern, !pattern.isEmpty else { return }
        search(pattern: pattern, direction: direction, textView: textView)
    }

    private func searchWordAtCaret(direction: SearchDirection, textView: NSTextView) {
        let nsString = textView.string as NSString
        guard let word = wordAtCaret(in: nsString, location: textView.selectedRange().location) else {
            return
        }
        let escaped = NSRegularExpression.escapedPattern(for: word)
        let pattern = "\\b\(escaped)\\b"
        lastSearchPattern = pattern
        lastSearchDirection = direction
        search(pattern: pattern, direction: direction, textView: textView)
    }

    private func search(pattern: String, direction: SearchDirection, textView: NSTextView) {
        let nsString = textView.string as NSString
        guard nsString.length > 0 else { return }
        let selection = textView.selectedRange()
        let match: NSRange?
        switch direction {
        case .forward:
            match = forwardSearch(pattern: pattern, in: nsString, after: selection)
        case .backward:
            match = backwardSearch(pattern: pattern, in: nsString, before: selection)
        }
        if let match, match.location != NSNotFound {
            textView.setSelectedRange(match)
            textView.scrollRangeToVisible(match)
        }
    }

    private func forwardSearch(pattern: String, in nsString: NSString, after selection: NSRange) -> NSRange? {
        let start = min(nsString.length, selection.location + max(1, selection.length))
        if start < nsString.length,
           let match = regexRange(pattern: pattern, in: nsString, range: NSRange(location: start, length: nsString.length - start), backwards: false) {
            return match
        }
        guard start > 0 else { return nil }
        return regexRange(pattern: pattern, in: nsString, range: NSRange(location: 0, length: start), backwards: false)
    }

    private func backwardSearch(pattern: String, in nsString: NSString, before selection: NSRange) -> NSRange? {
        let start = max(0, selection.location)
        if start > 0,
           let match = regexRange(pattern: pattern, in: nsString, range: NSRange(location: 0, length: start), backwards: true) {
            return match
        }
        guard start < nsString.length else { return nil }
        return regexRange(pattern: pattern, in: nsString, range: NSRange(location: start, length: nsString.length - start), backwards: true)
    }

    private func regexRange(pattern: String, in nsString: NSString, range: NSRange, backwards: Bool) -> NSRange? {
        guard range.length > 0 else { return nil }
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        if !backwards {
            return regex.firstMatch(in: nsString as String, range: range)?.range
        }

        var lastMatch: NSRange?
        regex.enumerateMatches(in: nsString as String, range: range) { match, _, _ in
            if let match {
                lastMatch = match.range
            }
        }
        return lastMatch
    }

    private func performSubstitution(command: String, textView: NSTextView) -> Bool {
        guard let substitution = parseSubstitution(command: command) else { return false }
        let pattern = substitution.pattern.isEmpty
            ? lastSearchPattern
            : normalizedSubstitutionPattern(substitution.pattern)
        guard let pattern, !pattern.isEmpty, let regex = try? NSRegularExpression(pattern: pattern) else {
            return true
        }
        lastSearchPattern = pattern

        let nsString = textView.string as NSString
        guard nsString.length > 0, let textStorage = textView.textStorage else { return true }
        let lines = lineEntries(in: nsString)
        guard !lines.isEmpty else { return true }
        let selectedLines = exLineRange(
            substitution.range,
            lines: lines,
            currentLocation: textView.selectedRange().location
        )
        guard selectedLines.lowerBound < lines.count else { return true }

        let source = nsString as String
        var replacementLocations: [Int] = []
        for lineIndex in selectedLines.reversed() {
            let lineRange = lines[lineIndex].contentRange
            guard lineRange.length > 0 else { continue }
            let matches: [NSTextCheckingResult]
            if substitution.isGlobal {
                matches = regex.matches(in: source, range: lineRange)
            } else if let match = regex.firstMatch(in: source, range: lineRange) {
                matches = [match]
            } else {
                matches = []
            }

            for match in matches.reversed() {
                let replacement = expandedSubstitutionReplacement(
                    substitution.replacement,
                    match: match,
                    in: nsString
                )
                textStorage.replaceCharacters(in: match.range, with: replacement)
                replacementLocations.append(match.range.location)
            }
        }

        if let location = replacementLocations.min() {
            textView.setSelectedRange(NSRange(location: min(location, textStorage.length), length: 0))
        }
        return true
    }

    private func normalizedSubstitutionPattern(_ pattern: String) -> String {
        var output = ""
        var index = pattern.startIndex
        while index < pattern.endIndex {
            let ch = pattern[index]
            if ch == "\\", pattern.index(after: index) < pattern.endIndex {
                let nextIndex = pattern.index(after: index)
                let next = pattern[nextIndex]
                if next == "(" || next == ")" {
                    output.append(next)
                } else {
                    output.append(ch)
                    output.append(next)
                }
                index = pattern.index(after: nextIndex)
                continue
            }
            output.append(ch)
            index = pattern.index(after: index)
        }
        return output
    }

    private func parseSubstitution(command: String) -> SubstitutionCommand? {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let commandStart = substitutionCommandStart(in: trimmed)
        guard let commandStart else { return nil }

        let rangePrefix = String(trimmed[..<commandStart]).trimmingCharacters(in: .whitespaces)
        var index = trimmed.index(after: commandStart)
        guard index < trimmed.endIndex else { return nil }
        let delimiter = trimmed[index]
        guard !delimiter.isLetter, !delimiter.isNumber, !delimiter.isWhitespace else { return nil }
        index = trimmed.index(after: index)

        guard let pattern = readDelimitedComponent(in: trimmed, from: &index, delimiter: delimiter) else {
            return nil
        }
        let replacement = readDelimitedComponent(in: trimmed, from: &index, delimiter: delimiter) ?? ""
        let flags = String(trimmed[index...])

        return SubstitutionCommand(
            range: rangePrefix.isEmpty ? nil : rangePrefix,
            pattern: pattern,
            replacement: replacement,
            isGlobal: flags.contains("g")
        )
    }

    private func substitutionCommandStart(in command: String) -> String.Index? {
        if command.first == "s" {
            return command.startIndex
        }

        var index = command.startIndex
        var hasRange = false
        while index < command.endIndex {
            let ch = command[index]
            if ch.isNumber || ch == "." || ch == "$" || ch == "%" || ch == "," || ch.isWhitespace {
                hasRange = true
                index = command.index(after: index)
            } else {
                break
            }
        }

        guard hasRange, index < command.endIndex, command[index] == "s" else { return nil }
        return index
    }

    private func readDelimitedComponent(in command: String, from index: inout String.Index, delimiter: Character) -> String? {
        var result = ""
        while index < command.endIndex {
            let ch = command[index]
            index = command.index(after: index)
            if ch == delimiter {
                return result
            }
            if ch == "\\", index < command.endIndex {
                let next = command[index]
                index = command.index(after: index)
                if next == delimiter {
                    result.append(next)
                } else {
                    result.append(ch)
                    result.append(next)
                }
            } else {
                result.append(ch)
            }
        }
        return result
    }

    private func expandedSubstitutionReplacement(
        _ replacement: String,
        match: NSTextCheckingResult,
        in nsString: NSString
    ) -> String {
        var output = ""
        var index = replacement.startIndex
        while index < replacement.endIndex {
            let ch = replacement[index]
            if ch == "&" {
                output += nsString.substring(with: match.range)
                index = replacement.index(after: index)
                continue
            }

            if ch == "\\", replacement.index(after: index) < replacement.endIndex {
                let nextIndex = replacement.index(after: index)
                let next = replacement[nextIndex]
                if let capture = next.wholeNumberValue, capture < match.numberOfRanges {
                    let range = match.range(at: capture)
                    if range.location != NSNotFound {
                        output += nsString.substring(with: range)
                    }
                } else {
                    output.append(next)
                }
                index = replacement.index(after: nextIndex)
                continue
            }

            output.append(ch)
            index = replacement.index(after: index)
        }
        return output
    }

    private func exLineRange(_ range: String?, lines: [LineEntry], currentLocation: Int) -> ClosedRange<Int> {
        let lineCount = lines.count
        guard let range, !range.isEmpty else {
            let line = currentLineIndex(in: lines, location: currentLocation)
            return line...line
        }
        if range == "%" {
            return 0...max(0, lineCount - 1)
        }

        let parts = range.split(separator: ",", omittingEmptySubsequences: false)
        let startAddress = parts.first.map(String.init) ?? "."
        let endAddress = parts.count > 1 ? String(parts[1]) : startAddress
        let start = exAddress(startAddress, lines: lines, currentLocation: currentLocation)
        let end = exAddress(endAddress, lines: lines, currentLocation: currentLocation)
        return min(start, end)...max(start, end)
    }

    private func exAddress(_ address: String, lines: [LineEntry], currentLocation: Int) -> Int {
        let trimmed = address.trimmingCharacters(in: .whitespaces)
        let lineCount = max(1, lines.count)
        if trimmed.isEmpty || trimmed == "." {
            return currentLineIndex(in: lines, location: currentLocation)
        }
        if trimmed == "$" {
            return lineCount - 1
        }
        if trimmed == "%" {
            return 0
        }
        if let lineNumber = Int(trimmed) {
            return min(max(1, lineNumber), lineCount) - 1
        }
        return currentLineIndex(in: lines, location: currentLocation)
    }

    private func currentLineIndex(in lines: [LineEntry], location: Int) -> Int {
        guard !lines.isEmpty else { return 0 }
        for (index, line) in lines.enumerated() {
            if location >= line.fullRange.location, location < NSMaxRange(line.fullRange) {
                return index
            }
        }
        return lines.count - 1
    }

    private func lineEntries(in nsString: NSString) -> [LineEntry] {
        guard nsString.length > 0 else {
            return [LineEntry(fullRange: NSRange(location: 0, length: 0), contentRange: NSRange(location: 0, length: 0))]
        }

        var entries: [LineEntry] = []
        var location = 0
        while location < nsString.length {
            let fullRange = nsString.lineRange(for: NSRange(location: location, length: 0))
            let contentRange = contentRange(forLineRange: fullRange, in: nsString)
            entries.append(LineEntry(fullRange: fullRange, contentRange: contentRange))
            location = NSMaxRange(fullRange)
        }
        return entries
    }

    private func contentRange(forLineRange lineRange: NSRange, in nsString: NSString) -> NSRange {
        var length = lineRange.length
        while length > 0 {
            let unit = nsString.character(at: lineRange.location + length - 1)
            if unit == 10 || unit == 13 {
                length -= 1
            } else {
                break
            }
        }
        return NSRange(location: lineRange.location, length: length)
    }

    private func wordAtCaret(in nsString: NSString, location: Int) -> String? {
        guard nsString.length > 0 else { return nil }
        var index = min(max(0, location), nsString.length - 1)
        if !isWordChar(nsString.character(at: index)), index > 0, isWordChar(nsString.character(at: index - 1)) {
            index -= 1
        }
        guard isWordChar(nsString.character(at: index)) else { return nil }
        var start = index
        var end = index + 1
        while start > 0, isWordChar(nsString.character(at: start - 1)) {
            start -= 1
        }
        while end < nsString.length, isWordChar(nsString.character(at: end)) {
            end += 1
        }
        return nsString.substring(with: NSRange(location: start, length: end - start))
    }

    // MARK: - Mode transitions

    func enterNormalMode() {
        mode = .normal
        pendingOperator = nil
        pendingOperatorCount = 1
        pendingTextObjectScope = nil
        pendingMarkCommand = nil
        pendingRegister = nil
        activeRegister = nil
        isPendingSingleReplace = false
        currentReplaceText = ""
        commandLineBuffer = ""
        commandLineKind = .ex
        onCommandLineChanged?(nil)
        resetPendingCount()
        if let textView {
            // Collapse selection to caret on mode exit, matching Vim's
            // behavior of leaving the cursor at the visual end.
            let range = textView.selectedRange()
            if range.length > 0 {
                textView.setSelectedRange(NSRange(location: range.location, length: 0))
            }
        }
        visualAnchor = nil
        visualFocus = nil
    }

    // MARK: - Caret motion helpers

    private func moveCaret(by delta: Int, textView: NSTextView) {
        let range = textView.selectedRange()
        let newLocation = max(0, min(textView.string.utf16.count, range.location + delta))
        textView.setSelectedRange(NSRange(location: newLocation, length: 0))
    }

    private func moveCaretLine(delta: Int, textView: NSTextView) {
        let storage = textView.textStorage
        let nsString = textView.string as NSString
        let currentLineRange = nsString.lineRange(
            for: NSRange(location: textView.selectedRange().location, length: 0)
        )
        let column = textView.selectedRange().location - currentLineRange.location
        if delta > 0 {
            let nextLineStart = currentLineRange.location + currentLineRange.length
            guard nextLineStart < (storage?.length ?? 0) else { return }
            let nextLineRange = nsString.lineRange(for: NSRange(location: nextLineStart, length: 0))
            let target = nextLineRange.location + min(column, max(0, nextLineRange.length - 1))
            textView.setSelectedRange(NSRange(location: target, length: 0))
        } else if delta < 0 {
            guard currentLineRange.location > 0 else { return }
            let prevLineRange = nsString.lineRange(
                for: NSRange(location: currentLineRange.location - 1, length: 0)
            )
            let target = prevLineRange.location + min(column, max(0, prevLineRange.length - 1))
            textView.setSelectedRange(NSRange(location: target, length: 0))
        }
    }

    private func moveCaretToLineStart(textView: NSTextView) {
        let nsString = textView.string as NSString
        let line = nsString.lineRange(
            for: NSRange(location: textView.selectedRange().location, length: 0)
        )
        textView.setSelectedRange(NSRange(location: line.location, length: 0))
    }

    private func moveCaretToLineEnd(textView: NSTextView) {
        let nsString = textView.string as NSString
        let line = nsString.lineRange(
            for: NSRange(location: textView.selectedRange().location, length: 0)
        )
        // Subtract the trailing newline if present so $ matches Vim.
        let target = line.location + max(0, line.length - 1)
        textView.setSelectedRange(NSRange(location: target, length: 0))
    }

    private func moveCaretToDocumentStart(textView: NSTextView) {
        textView.setSelectedRange(NSRange(location: 0, length: 0))
    }

    private func moveCaretToDocumentEnd(textView: NSTextView) {
        let length = textView.textStorage?.length ?? textView.string.utf16.count
        textView.setSelectedRange(NSRange(location: length, length: 0))
    }

    private func moveCaretWord(forward: Bool, textView: NSTextView) {
        let nsString = textView.string as NSString
        let location = textView.selectedRange().location
        let target: Int
        if forward {
            target = nextWordStart(in: nsString, from: location)
        } else {
            target = previousWordStart(in: nsString, from: location)
        }
        textView.setSelectedRange(NSRange(location: target, length: 0))
    }

    private func nextWordStart(in nsString: NSString, from location: Int) -> Int {
        var index = location
        let length = nsString.length
        // Skip the current word.
        while index < length, isWordChar(nsString.character(at: index)) {
            index += 1
        }
        // Skip whitespace.
        while index < length, !isWordChar(nsString.character(at: index)) {
            index += 1
        }
        return index
    }

    private func previousWordStart(in nsString: NSString, from location: Int) -> Int {
        var index = location
        guard index > 0 else { return 0 }
        index -= 1
        while index > 0, !isWordChar(nsString.character(at: index)) {
            index -= 1
        }
        while index > 0, isWordChar(nsString.character(at: index - 1)) {
            index -= 1
        }
        return index
    }

    private func isWordChar(_ unit: unichar) -> Bool {
        let scalar = UnicodeScalar(unit)
        // Word chars per Vim's iskeyword default: alnum + underscore.
        return scalar.map {
            CharacterSet.alphanumerics.contains($0) || $0 == "_"
        } ?? false
    }

    private func wordRange(at location: Int, in nsString: NSString) -> NSRange? {
        guard nsString.length > 0 else { return nil }
        var index = min(max(0, location), nsString.length - 1)
        if !isWordChar(nsString.character(at: index)) {
            if index > 0, isWordChar(nsString.character(at: index - 1)) {
                index -= 1
            } else {
                return nil
            }
        }

        var start = index
        var end = index + 1
        while start > 0, isWordChar(nsString.character(at: start - 1)) {
            start -= 1
        }
        while end < nsString.length, isWordChar(nsString.character(at: end)) {
            end += 1
        }
        return NSRange(location: start, length: end - start)
    }

    private func aroundWordRange(_ word: NSRange, in nsString: NSString) -> NSRange {
        var start = word.location
        var end = word.location + word.length
        while end < nsString.length, CharacterSet.whitespacesAndNewlines.containsUnicodeUnit(nsString.character(at: end)) {
            end += 1
        }
        if end == word.location + word.length {
            while start > 0, CharacterSet.whitespacesAndNewlines.containsUnicodeUnit(nsString.character(at: start - 1)) {
                start -= 1
            }
        }
        return NSRange(location: start, length: end - start)
    }

    private func isQuoteObject(_ ch: Character) -> Bool {
        ch == "\"" || ch == "'" || ch == "`"
    }

    private func quotedRange(scope: TextObjectScope, quote: Character, in nsString: NSString, at location: Int) -> NSRange? {
        guard nsString.length > 1, let quoteUnit = quote.utf16Unit else { return nil }
        let bounded = min(max(0, location), nsString.length - 1)
        var quotes: [Int] = []
        var index = 0
        while index < nsString.length {
            if nsString.character(at: index) == quoteUnit, !isEscaped(index, in: nsString) {
                quotes.append(index)
            }
            index += 1
        }

        var pair: (open: Int, close: Int)?
        var pairIndex = 0
        while pairIndex + 1 < quotes.count {
            let open = quotes[pairIndex]
            let close = quotes[pairIndex + 1]
            if open <= bounded, bounded <= close {
                pair = (open, close)
                break
            }
            pairIndex += 2
        }
        guard let pair else { return nil }
        switch scope {
        case .inner:
            return NSRange(location: pair.open + 1, length: pair.close - pair.open - 1)
        case .around:
            return NSRange(location: pair.open, length: pair.close - pair.open + 1)
        }
    }

    private func isEscaped(_ location: Int, in nsString: NSString) -> Bool {
        guard location > 0 else { return false }
        let slash = Character("\\").utf16Unit ?? 0
        var slashCount = 0
        var index = location - 1
        while index >= 0, nsString.character(at: index) == slash {
            slashCount += 1
            index -= 1
        }
        return slashCount % 2 == 1
    }

    private func bracketPair(for ch: Character) -> (open: unichar, close: unichar)? {
        switch ch {
        case "(", ")":
            return (Character("(").utf16Unit ?? 0, Character(")").utf16Unit ?? 0)
        case "[", "]":
            return (Character("[").utf16Unit ?? 0, Character("]").utf16Unit ?? 0)
        case "{", "}":
            return (Character("{").utf16Unit ?? 0, Character("}").utf16Unit ?? 0)
        case "<", ">":
            return (Character("<").utf16Unit ?? 0, Character(">").utf16Unit ?? 0)
        default:
            return nil
        }
    }

    private func bracketedRange(
        scope: TextObjectScope,
        open: unichar,
        close: unichar,
        count: Int,
        in nsString: NSString,
        at location: Int
    ) -> NSRange? {
        guard nsString.length > 1 else { return nil }
        let bounded = min(max(0, location), nsString.length - 1)
        var stack: [Int] = []
        var containingPairs: [(open: Int, close: Int)] = []

        for index in 0..<nsString.length {
            let unit = nsString.character(at: index)
            if unit == open {
                stack.append(index)
            } else if unit == close, let opening = stack.popLast() {
                if opening <= bounded, bounded <= index {
                    containingPairs.append((opening, index))
                }
            }
        }

        guard !containingPairs.isEmpty else { return nil }
        let sorted = containingPairs.sorted { lhs, rhs in
            let lhsLength = lhs.close - lhs.open
            let rhsLength = rhs.close - rhs.open
            return lhsLength < rhsLength
        }
        let pair = sorted[min(max(1, count), sorted.count) - 1]
        switch scope {
        case .inner:
            return NSRange(location: pair.open + 1, length: pair.close - pair.open - 1)
        case .around:
            return NSRange(location: pair.open, length: pair.close - pair.open + 1)
        }
    }

    // MARK: - Edits

    private func insertNewline(textView: NSTextView) {
        let location = textView.selectedRange().location
        textView.textStorage?.replaceCharacters(in: NSRange(location: location, length: 0), with: "\n")
        textView.setSelectedRange(NSRange(location: location + 1, length: 0))
    }

    private func replaceCharacter(with replacement: String, textView: NSTextView) -> Bool {
        guard !replacement.isEmpty, let textStorage = textView.textStorage else { return false }
        let location = textView.selectedRange().location
        let length = textStorage.length
        let range = location < length
            ? NSRange(location: location, length: 1)
            : NSRange(location: length, length: 0)
        textStorage.replaceCharacters(in: range, with: replacement)
        textView.setSelectedRange(NSRange(location: range.location + replacement.utf16.count, length: 0))
        return true
    }

    private func deleteCharForward(count: Int, textView: NSTextView) -> Bool {
        let location = textView.selectedRange().location
        let length = textView.textStorage?.length ?? 0
        guard location < length else { return false }
        let deleteLength = min(count, length - location)
        textView.textStorage?.replaceCharacters(in: NSRange(location: location, length: deleteLength), with: "")
        return deleteLength > 0
    }

    private func deleteCurrentLine(count: Int, textView: NSTextView) -> Bool {
        let nsString = textView.string as NSString
        let line = lineRange(count: count, in: nsString, from: textView.selectedRange().location)
        guard line.length > 0 else { return false }
        storeYank(nsString.substring(with: line))
        textView.textStorage?.replaceCharacters(in: line, with: "")
        let target = min(line.location, textView.textStorage?.length ?? 0)
        textView.setSelectedRange(NSRange(location: target, length: 0))
        return true
    }

    private func deleteRange(_ range: NSRange, textView: NSTextView) -> Bool {
        guard range.length > 0 else { return false }
        let nsString = textView.string as NSString
        guard NSMaxRange(range) <= nsString.length else { return false }
        storeYank(nsString.substring(with: range))
        textView.textStorage?.replaceCharacters(in: range, with: "")
        textView.setSelectedRange(NSRange(location: min(range.location, textView.textStorage?.length ?? 0), length: 0))
        return true
    }

    private func yankCurrentLine(count: Int, textView: NSTextView) {
        let nsString = textView.string as NSString
        let line = lineRange(count: count, in: nsString, from: textView.selectedRange().location)
        guard line.length > 0 else { return }
        storeYank(nsString.substring(with: line))
    }

    private func lineRange(count: Int, in nsString: NSString, from location: Int) -> NSRange {
        guard nsString.length > 0 else { return NSRange(location: 0, length: 0) }
        let boundedLocation = min(max(0, location), nsString.length - 1)
        let firstLine = nsString.lineRange(for: NSRange(location: boundedLocation, length: 0))
        var end = firstLine.location
        var remaining = max(1, count)
        while remaining > 0, end < nsString.length {
            let line = nsString.lineRange(for: NSRange(location: end, length: 0))
            end = line.location + line.length
            remaining -= 1
        }
        return NSRange(location: firstLine.location, length: end - firstLine.location)
    }

    private func pasteAfterCaret(_ text: String, textView: NSTextView) -> Bool {
        guard !text.isEmpty else { return false }
        let location = textView.selectedRange().location
        // Vim's `p` puts after the cursor for character-wise yanks; for
        // line-wise yanks it puts on the line below. We treat the
        // yanked text as line-wise when it ends in a newline.
        if text.hasSuffix("\n") {
            let nsString = textView.string as NSString
            let line = nsString.lineRange(for: NSRange(location: location, length: 0))
            let insertion = line.location + line.length
            textView.textStorage?.replaceCharacters(
                in: NSRange(location: insertion, length: 0),
                with: text
            )
            textView.setSelectedRange(NSRange(location: insertion, length: 0))
            return true
        } else {
            let insertion = min(location + 1, textView.textStorage?.length ?? 0)
            textView.textStorage?.replaceCharacters(
                in: NSRange(location: insertion, length: 0),
                with: text
            )
            textView.setSelectedRange(NSRange(location: insertion + text.utf16.count, length: 0))
            return true
        }
    }

    private func deleteSelection(textView: NSTextView) {
        let range = textView.selectedRange()
        guard range.length > 0 else { return }
        storeYank((textView.string as NSString).substring(with: range))
        textView.textStorage?.replaceCharacters(in: range, with: "")
        textView.setSelectedRange(NSRange(location: range.location, length: 0))
    }

    private func yankSelection(textView: NSTextView) {
        let range = textView.selectedRange()
        guard range.length > 0 else { return }
        storeYank((textView.string as NSString).substring(with: range))
    }

    // MARK: - Visual selection extension

    private func extendSelection(by delta: Int, textView: NSTextView) {
        guard let anchor = visualAnchor else { return }
        let current = visualFocus ?? (textView.selectedRange().location + textView.selectedRange().length)
        let newCaret = max(0, min(textView.textStorage?.length ?? 0, current + delta))
        visualFocus = newCaret
        textView.setSelectedRange(rangeBetween(anchor: anchor, caret: newCaret))
    }

    private func extendSelectionLine(delta: Int, textView: NSTextView) {
        guard let anchor = visualAnchor else { return }
        let nsString = textView.string as NSString
        let currentEnd = visualFocus ?? (textView.selectedRange().location + textView.selectedRange().length)
        let currentLine = nsString.lineRange(for: NSRange(location: currentEnd, length: 0))
        let column = currentEnd - currentLine.location
        let newCaret: Int
        if delta > 0 {
            let nextStart = currentLine.location + currentLine.length
            guard nextStart < nsString.length else { return }
            let nextLine = nsString.lineRange(for: NSRange(location: nextStart, length: 0))
            newCaret = nextLine.location + min(column, max(0, nextLine.length - 1))
        } else {
            guard currentLine.location > 0 else { return }
            let prevLine = nsString.lineRange(
                for: NSRange(location: currentLine.location - 1, length: 0)
            )
            newCaret = prevLine.location + min(column, max(0, prevLine.length - 1))
        }
        visualFocus = newCaret
        textView.setSelectedRange(rangeBetween(anchor: anchor, caret: newCaret))
    }

    private func extendSelectionToLineStart(textView: NSTextView) {
        guard let anchor = visualAnchor else { return }
        let nsString = textView.string as NSString
        let currentEnd = visualFocus ?? (textView.selectedRange().location + textView.selectedRange().length)
        let line = nsString.lineRange(for: NSRange(location: currentEnd, length: 0))
        visualFocus = line.location
        textView.setSelectedRange(rangeBetween(anchor: anchor, caret: line.location))
    }

    private func extendSelectionToLineEnd(textView: NSTextView) {
        guard let anchor = visualAnchor else { return }
        let nsString = textView.string as NSString
        let currentEnd = visualFocus ?? (textView.selectedRange().location + textView.selectedRange().length)
        let line = nsString.lineRange(for: NSRange(location: currentEnd, length: 0))
        let lineEnd = line.location + max(0, line.length - 1)
        visualFocus = lineEnd
        textView.setSelectedRange(rangeBetween(anchor: anchor, caret: lineEnd))
    }

    private func enterVisualLineMode(textView: NSTextView) {
        let nsString = textView.string as NSString
        let line = nsString.lineRange(for: NSRange(location: textView.selectedRange().location, length: 0))
        mode = .visualLine
        visualAnchor = line.location
        visualFocus = line.location
        textView.setSelectedRange(line)
    }

    private func extendVisualLine(delta: Int, textView: NSTextView) {
        guard let anchor = visualAnchor, let focus = visualFocus else { return }
        let nsString = textView.string as NSString
        guard nsString.length > 0 else { return }
        let currentLine = nsString.lineRange(for: NSRange(location: min(focus, nsString.length - 1), length: 0))
        let nextLine: NSRange
        if delta > 0 {
            let nextStart = currentLine.location + currentLine.length
            guard nextStart < nsString.length else { return }
            nextLine = nsString.lineRange(for: NSRange(location: nextStart, length: 0))
        } else {
            guard currentLine.location > 0 else { return }
            nextLine = nsString.lineRange(for: NSRange(location: currentLine.location - 1, length: 0))
        }
        visualFocus = nextLine.location
        textView.setSelectedRange(visualLineRange(anchor: anchor, focus: nextLine.location, in: nsString))
    }

    private func visualLineRange(anchor: Int, focus: Int, in nsString: NSString) -> NSRange {
        guard nsString.length > 0 else { return NSRange(location: 0, length: 0) }
        let anchorLine = nsString.lineRange(for: NSRange(location: min(anchor, nsString.length - 1), length: 0))
        let focusLine = nsString.lineRange(for: NSRange(location: min(focus, nsString.length - 1), length: 0))
        let start = min(anchorLine.location, focusLine.location)
        let end = max(anchorLine.location + anchorLine.length, focusLine.location + focusLine.length)
        return NSRange(location: start, length: end - start)
    }

    private func rangeBetween(anchor: Int, caret: Int) -> NSRange {
        let lo = min(anchor, caret)
        let hi = max(anchor, caret)
        return NSRange(location: lo, length: hi - lo)
    }
}

private extension Character {
    var utf16Unit: unichar? {
        let units = String(self).utf16
        guard units.count == 1 else { return nil }
        return units.first
    }
}

private extension CharacterSet {
    func containsUnicodeUnit(_ unit: unichar) -> Bool {
        UnicodeScalar(unit).map { contains($0) } ?? false
    }
}
