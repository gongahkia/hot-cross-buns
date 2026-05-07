import AppKit

/// `NSTextView` subclass that intercepts Cmd-B / Cmd-I / Cmd-U / Cmd-K
/// directly via `performKeyEquivalent` and emits style envelopes on
/// non-empty selections. We deliberately avoid going through the
/// Format-menu responder chain (`boldfaceText:` / `italicizeText:` /
/// `underline:`) because the SwiftUI shell does not register a Format
/// menu, so those actions reach NSTextView's default implementations
/// (which mutate typing attributes only — invisible to our
/// operation log).
///
/// The host (`RichTextEditorView.Coordinator`) is responsible for
/// turning a `StyleCommand` into a fully-serialized envelope and
/// forwarding it to the FFI. We intentionally do not mutate the local
/// NSTextStorage here — apply runs server-side via push, and the next
/// re-pull rerenders the storage from the canonical RichDocument. This
/// keeps the local view from going out of sync with what we'll actually
/// send. (V2 will optimistically apply locally and reconcile on
/// re-pull; the operation log already supports it.)
final class MelonPanTextView: NSTextView {
    /// Forwarded to the SwiftUI wrapper's coordinator.
    var emitStyleCommand: ((StyleCommand) -> Void)?
    private var activeTableResizeDrag: TableResizeDrag?

    /// Lazily created Vim controller. nil until `enableVimMode()` is
    /// called so the regular AppKit edit path is unchanged for users who
    /// don't want it.
    private var vim: VimController?

    /// Notifies the host whenever Vim mode toggles on or changes its
    /// internal mode. The SwiftUI wrapper uses this to render a small
    /// mode indicator in the status bar.
    var onVimModeChanged: ((VimModeLabel) -> Void)?
    var onVimCommandLineChanged: ((String?) -> Void)?
    var onVimExCommand: ((VimController.ExCommand) -> Void)?

    enum VimModeLabel: Equatable {
        case off
        case normal
        case insert
        case visual
        case commandLine
    }

    /// Toggle Vim emulation. When enabling we start in normal mode (the
    /// classic Vim default). When disabling, the controller is dropped
    /// so AppKit's standard key handling takes over again.
    func setVimEnabled(_ enabled: Bool) {
        if enabled {
            if vim == nil {
                let controller = VimController(textView: self)
                configureVimController(controller)
                controller.enterNormalMode()
                vim = controller
            } else if let vim {
                configureVimController(vim)
            }
            onVimModeChanged?(.normal)
        } else {
            vim = nil
            onVimModeChanged?(.off)
        }
    }

    var isVimEnabled: Bool { vim != nil }

    private func configureVimController(_ controller: VimController) {
        controller.onCommandLineChanged = { [weak self] commandLine in
            self?.onVimCommandLineChanged?(commandLine)
        }
        controller.onExCommand = { [weak self] command in
            self?.onVimExCommand?(command)
        }
    }

    override func keyDown(with event: NSEvent) {
        if let vim, vim.handleKeyDown(event) {
            // Re-emit mode label so the status bar reflects mode changes
            // (e.g. i / ESC / v transitions).
            onVimModeChanged?(currentVimModeLabel)
            return
        }
        if isEditable {
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let chars = event.charactersIgnoringModifiers ?? ""
            if chars == "\t" {
                if modifiers.isEmpty, tryMoveSelectionToAdjacentTableCell(reverse: false) {
                    return
                }
                if modifiers == .shift, tryMoveSelectionToAdjacentTableCell(reverse: true) {
                    return
                }
                if modifiers.isEmpty, tryUpdateListNesting(delta: 1) {
                    return
                }
                if modifiers == .shift, tryUpdateListNesting(delta: -1) {
                    return
                }
            }
        }
        super.keyDown(with: event)
        // After inserts in insert mode, refresh label too — handles the
        // case where the controller did not consume the event but the
        // user just typed in insert mode (no transition expected, but
        // keeps the label honest if the controller's state changed).
        onVimModeChanged?(currentVimModeLabel)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawTableResizeHandles()
    }

    override func mouseDown(with event: NSEvent) {
        if isEditable,
           let drag = tableResizeDrag(at: convert(event.locationInWindow, from: nil)) {
            activeTableResizeDrag = drag
            needsDisplay = true
            return
        }
        super.mouseDown(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        guard var drag = activeTableResizeDrag else {
            super.mouseDragged(with: event)
            return
        }
        let point = convert(event.locationInWindow, from: nil)
        drag.currentPoint = point
        activeTableResizeDrag = drag
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard var drag = activeTableResizeDrag else {
            super.mouseUp(with: event)
            return
        }
        drag.currentPoint = convert(event.locationInWindow, from: nil)
        activeTableResizeDrag = nil
        needsDisplay = true
        switch drag.edge {
        case .column:
            let width = max(24.0, drag.startDimension + Double(drag.currentPoint.x - drag.startPoint.x))
            emitStyleCommand?(.resizeTableColumn(widthPt: width))
        case .row:
            let height = max(16.0, drag.startDimension + Double(drag.currentPoint.y - drag.startPoint.y))
            emitStyleCommand?(.resizeTableRow(minHeightPt: height))
        }
    }

    private var currentVimModeLabel: VimModeLabel {
        guard let vim else { return .off }
        switch vim.mode {
        case .normal: return .normal
        case .insert: return .insert
        case .visualCharacter, .visualLine: return .visual
        case .replace: return .insert
        case .commandLine: return .commandLine
        }
    }

    enum StyleCommand: Equatable {
        struct RGBColor: Equatable {
            let red: Double
            let green: Double
            let blue: Double
        }

        case bold
        case italic
        case underline
        case clearFormatting
        case setFontFamilyTimes
        case setFont(familyName: String, sizePt: Double)
        case setFontSize(Double)
        case increaseFontSize
        case decreaseFontSize
        case setTextColorRed
        case setTextColor(RGBColor)
        case setTextBackgroundYellow
        case setTextBackgroundColor(RGBColor)
        case clearFontAndColors
        case alignLeft
        case alignCenter
        case alignRight
        case alignJustified
        case setParagraphNamedStyle(String)
        case link(url: String)
        case toggleNumberedList
        case toggleBulletedList
        case listIndent
        case listOutdent
        case insertTable(rows: Int, columns: Int)
        case insertTableRowAbove
        case insertTableRowBelow
        case deleteTableRow
        case insertTableColumnLeft
        case insertTableColumnRight
        case deleteTableColumn
        case deleteTable
        case setTableCellBackgroundYellow
        case setTableCellBackgroundColor(RGBColor)
        case clearTableCellBackground
        case setTableCellBorderThin
        case setTableCellBorderColor(RGBColor)
        case setTableCellBorderDashStyle(String)
        case setTableCellTopBorderThin
        case setTableCellRightBorderThin
        case setTableCellBottomBorderThin
        case setTableCellLeftBorderThin
        case clearTableCellBorder
        case clearTableCellTopBorder
        case clearTableCellRightBorder
        case clearTableCellBottomBorder
        case clearTableCellLeftBorder
        case setTableCellVerticalAlignment(String)
        case clearTableCellVerticalAlignment
        case resizeTableColumn(widthPt: Double)
        case resizeTableRow(minHeightPt: Double)
        case increaseTableCellPadding
        case decreaseTableCellPadding
        case clearTableCellPadding
        case mergeSelectedTableCells
        case unmergeTableCell
        case insertInlineImage(uri: String)
        case deleteInlineObject
        case createHeader
        case deleteCurrentHeader
        case createFooter
        case deleteCurrentFooter
        case createFootnote
        case deleteCurrentFootnote

        var canApplyAtInsertionPoint: Bool {
            switch self {
            case .bold, .italic, .underline, .clearFormatting,
                 .setFontFamilyTimes, .setFont, .setFontSize,
                 .increaseFontSize, .decreaseFontSize,
                 .setTextColorRed, .setTextColor,
                 .setTextBackgroundYellow, .setTextBackgroundColor,
                 .clearFontAndColors:
                return true
            default:
                return false
            }
        }
    }

    func performEditorCommand(_ command: RichTextEditorCommand) {
        window?.makeFirstResponder(self)
        switch command {
        case let .emit(styleCommand):
            emitStyleCommand?(styleCommand)
        case .promptLink:
            _ = tryPromptForLink()
        case .promptInlineImage:
            _ = tryPromptForInlineImage()
        case .promptTextColor:
            _ = tryPromptForColor(target: .foreground)
        case .promptHighlightColor:
            _ = tryPromptForColor(target: .background)
        case .showFontPanel:
            melonPanShowFontPanel(nil)
        case .promptTableCellBackground:
            _ = tryPromptForTableCellBackgroundColor()
        case .promptTableCellBorder:
            _ = tryPromptForTableCellBorderColor()
        case .promptTableColumnWidth:
            melonPanSetTableColumnWidth(nil)
        case .promptTableRowHeight:
            melonPanSetTableRowHeight(nil)
        }
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard isEditable else { return super.performKeyEquivalent(with: event) }
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let chars = event.charactersIgnoringModifiers?.lowercased() ?? ""

        // Cmd + key (no other modifiers): formatting toggles + link.
        if modifiers == .command {
            switch chars {
            case "b": return tryEmit(.bold)
            case "i": return tryEmit(.italic)
            case "u": return tryEmit(.underline)
            case "k": return tryPromptForLink()
            case "g": return tryPromptForInlineImage()
            default: break
            }
        }

        // Cmd + Shift + 7 / 8 — match Apple Notes / Pages: numbered &
        // bulleted list toggles. The keyboard reports the digit
        // characters as `7` and `8` regardless of layout.
        if modifiers == [.command, .shift] {
            switch chars {
            case "7", "&": return tryToggleList(ordered: true)
            case "8", "*": return tryToggleList(ordered: false)
            case "t": return tryEmit(.clearFormatting)
            default: break
            }
        }

        if chars == "\t" {
            if modifiers.isEmpty, tryMoveSelectionToAdjacentTableCell(reverse: false) {
                return true
            }
            if modifiers == .shift, tryMoveSelectionToAdjacentTableCell(reverse: true) {
                return true
            }
            if modifiers.isEmpty {
                return tryUpdateListNesting(delta: 1)
            }
            if modifiers == .shift {
                return tryUpdateListNesting(delta: -1)
            }
        }

        return super.performKeyEquivalent(with: event)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        let location = characterIndex(for: event)
        if isEditable {
            ensureRightClickSelection(for: location)
            appendFormattingMenu(to: menu)
        }
        guard let location, isTableLocation(location) else {
            return menu
        }
        if menu.numberOfItems > 0 {
            menu.addItem(.separator())
        }
        addMenuItem("Insert Row Above", #selector(melonPanInsertTableRowAbove(_:)), to: menu)
        addMenuItem("Insert Row Below", #selector(melonPanInsertTableRowBelow(_:)), to: menu)
        addMenuItem("Delete Row", #selector(melonPanDeleteTableRow(_:)), to: menu)
        menu.addItem(.separator())
        addMenuItem("Insert Column Left", #selector(melonPanInsertTableColumnLeft(_:)), to: menu)
        addMenuItem("Insert Column Right", #selector(melonPanInsertTableColumnRight(_:)), to: menu)
        addMenuItem("Delete Column", #selector(melonPanDeleteTableColumn(_:)), to: menu)
        menu.addItem(.separator())
        addMenuItem(
            "Set Cell Background Yellow",
            #selector(melonPanSetTableCellBackgroundYellow(_:)),
            to: menu
        )
        addMenuItem(
            "Choose Cell Background...",
            #selector(melonPanChooseTableCellBackgroundColor(_:)),
            to: menu
        )
        addMenuItem(
            "Clear Cell Background",
            #selector(melonPanClearTableCellBackground(_:)),
            to: menu
        )
        menu.addItem(.separator())
        addMenuItem("Thin Borders", #selector(melonPanSetTableCellBorderThin(_:)), to: menu)
        let edgeMenu = NSMenu()
        addMenuItem("Top Border", #selector(melonPanSetTableCellTopBorderThin(_:)), to: edgeMenu)
        addMenuItem("Right Border", #selector(melonPanSetTableCellRightBorderThin(_:)), to: edgeMenu)
        addMenuItem("Bottom Border", #selector(melonPanSetTableCellBottomBorderThin(_:)), to: edgeMenu)
        addMenuItem("Left Border", #selector(melonPanSetTableCellLeftBorderThin(_:)), to: edgeMenu)
        edgeMenu.addItem(.separator())
        addMenuItem("Clear Top Border", #selector(melonPanClearTableCellTopBorder(_:)), to: edgeMenu)
        addMenuItem("Clear Right Border", #selector(melonPanClearTableCellRightBorder(_:)), to: edgeMenu)
        addMenuItem("Clear Bottom Border", #selector(melonPanClearTableCellBottomBorder(_:)), to: edgeMenu)
        addMenuItem("Clear Left Border", #selector(melonPanClearTableCellLeftBorder(_:)), to: edgeMenu)
        addSubmenu("Thin Edge Border", edgeMenu, to: menu)
        addMenuItem("Choose Border Color...", #selector(melonPanChooseTableCellBorderColor(_:)), to: menu)
        let borderStyleMenu = NSMenu()
        addMenuItem("Solid", #selector(melonPanSetTableCellBorderSolid(_:)), to: borderStyleMenu)
        addMenuItem("Dotted", #selector(melonPanSetTableCellBorderDotted(_:)), to: borderStyleMenu)
        addMenuItem("Dashed", #selector(melonPanSetTableCellBorderDashed(_:)), to: borderStyleMenu)
        addSubmenu("Border Style", borderStyleMenu, to: menu)
        addMenuItem("Clear Borders", #selector(melonPanClearTableCellBorder(_:)), to: menu)
        let verticalAlignmentMenu = NSMenu()
        addMenuItem("Top", #selector(melonPanAlignTableCellTop(_:)), to: verticalAlignmentMenu)
        addMenuItem("Middle", #selector(melonPanAlignTableCellMiddle(_:)), to: verticalAlignmentMenu)
        addMenuItem("Bottom", #selector(melonPanAlignTableCellBottom(_:)), to: verticalAlignmentMenu)
        verticalAlignmentMenu.addItem(.separator())
        addMenuItem(
            "Clear Vertical Alignment",
            #selector(melonPanClearTableCellVerticalAlignment(_:)),
            to: verticalAlignmentMenu
        )
        addSubmenu("Vertical Alignment", verticalAlignmentMenu, to: menu)
        addMenuItem("Set Column Width...", #selector(melonPanSetTableColumnWidth(_:)), to: menu)
        addMenuItem("Set Row Height...", #selector(melonPanSetTableRowHeight(_:)), to: menu)
        addMenuItem("Increase Padding", #selector(melonPanIncreaseTableCellPadding(_:)), to: menu)
        addMenuItem("Decrease Padding", #selector(melonPanDecreaseTableCellPadding(_:)), to: menu)
        addMenuItem("Clear Padding", #selector(melonPanClearTableCellPadding(_:)), to: menu)
        menu.addItem(.separator())
        addMenuItem("Merge Selected Cells", #selector(melonPanMergeSelectedTableCells(_:)), to: menu)
        addMenuItem("Unmerge Cell", #selector(melonPanUnmergeTableCell(_:)), to: menu)
        menu.addItem(.separator())
        addMenuItem("Delete Table", #selector(melonPanDeleteTable(_:)), to: menu)
        return menu
    }

    private func appendFormattingMenu(to menu: NSMenu) {
        if menu.numberOfItems > 0 {
            menu.addItem(.separator())
        }

        addMenuItem("Bold", #selector(melonPanToggleBold(_:)), to: menu)
        addMenuItem("Italic", #selector(melonPanToggleItalic(_:)), to: menu)
        addMenuItem("Underline", #selector(melonPanToggleUnderline(_:)), to: menu)
        addMenuItem("Clear Formatting", #selector(melonPanClearFormatting(_:)), to: menu)

        let fontMenu = NSMenu()
        addMenuItem("Show Fonts", #selector(melonPanShowFontPanel(_:)), to: fontMenu)
        addMenuItem("Times New Roman", #selector(melonPanSetFontFamilyTimes(_:)), to: fontMenu)
        addMenuItem("Increase Font Size", #selector(melonPanIncreaseFontSize(_:)), to: fontMenu)
        addMenuItem("Decrease Font Size", #selector(melonPanDecreaseFontSize(_:)), to: fontMenu)
        addMenuItem("Clear Font and Colors", #selector(melonPanClearFontAndColors(_:)), to: fontMenu)
        addSubmenu("Font", fontMenu, to: menu)

        let colorMenu = NSMenu()
        addMenuItem("Red Text", #selector(melonPanSetTextColorRed(_:)), to: colorMenu)
        addMenuItem("Choose Text Color...", #selector(melonPanChooseTextColor(_:)), to: colorMenu)
        addSubmenu("Text Color", colorMenu, to: menu)

        let highlightMenu = NSMenu()
        addMenuItem("Yellow Highlight", #selector(melonPanSetTextBackgroundYellow(_:)), to: highlightMenu)
        addMenuItem("Choose Highlight Color...", #selector(melonPanChooseTextBackgroundColor(_:)), to: highlightMenu)
        addSubmenu("Highlight", highlightMenu, to: menu)

        let linkMediaMenu = NSMenu()
        addMenuItem("Link", #selector(melonPanCreateLink(_:)), to: linkMediaMenu)
        addMenuItem("Insert Image From URL", #selector(melonPanInsertInlineImage(_:)), to: linkMediaMenu)
        addMenuItem("Delete Selected Image", #selector(melonPanDeleteInlineObject(_:)), to: linkMediaMenu)
        addSubmenu("Links and Media", linkMediaMenu, to: menu)

        let notesMenu = NSMenu()
        addMenuItem("Create Header", #selector(melonPanCreateHeader(_:)), to: notesMenu)
        addMenuItem("Delete Current Header", #selector(melonPanDeleteCurrentHeader(_:)), to: notesMenu)
        addMenuItem("Create Footer", #selector(melonPanCreateFooter(_:)), to: notesMenu)
        addMenuItem("Delete Current Footer", #selector(melonPanDeleteCurrentFooter(_:)), to: notesMenu)
        addMenuItem("Create Footnote", #selector(melonPanCreateFootnote(_:)), to: notesMenu)
        addMenuItem("Delete Current Footnote", #selector(melonPanDeleteCurrentFootnote(_:)), to: notesMenu)
        addSubmenu("Headers, Footers, Footnotes", notesMenu, to: menu)

        let listMenu = NSMenu()
        addMenuItem("Numbered List", #selector(melonPanToggleNumberedList(_:)), to: listMenu)
        addMenuItem("Bulleted List", #selector(melonPanToggleBulletedList(_:)), to: listMenu)
        addSubmenu("Lists", listMenu, to: menu)

        let alignmentMenu = NSMenu()
        addMenuItem("Align Left", #selector(melonPanAlignLeft(_:)), to: alignmentMenu)
        addMenuItem("Align Center", #selector(melonPanAlignCenter(_:)), to: alignmentMenu)
        addMenuItem("Align Right", #selector(melonPanAlignRight(_:)), to: alignmentMenu)
        addMenuItem("Justify", #selector(melonPanAlignJustified(_:)), to: alignmentMenu)
        addSubmenu("Alignment", alignmentMenu, to: menu)

        let tableMenu = NSMenu()
        addMenuItem("Insert 2 x 2 Table", #selector(melonPanInsertTable(_:)), to: tableMenu)
        addMenuItem("Insert Row Above", #selector(melonPanInsertTableRowAbove(_:)), to: tableMenu)
        addMenuItem("Insert Row Below", #selector(melonPanInsertTableRowBelow(_:)), to: tableMenu)
        addMenuItem("Delete Row", #selector(melonPanDeleteTableRow(_:)), to: tableMenu)
        tableMenu.addItem(.separator())
        addMenuItem("Insert Column Left", #selector(melonPanInsertTableColumnLeft(_:)), to: tableMenu)
        addMenuItem("Insert Column Right", #selector(melonPanInsertTableColumnRight(_:)), to: tableMenu)
        addMenuItem("Delete Column", #selector(melonPanDeleteTableColumn(_:)), to: tableMenu)
        tableMenu.addItem(.separator())
        addMenuItem("Set Cell Background Yellow", #selector(melonPanSetTableCellBackgroundYellow(_:)), to: tableMenu)
        addMenuItem("Choose Cell Background...", #selector(melonPanChooseTableCellBackgroundColor(_:)), to: tableMenu)
        addMenuItem("Clear Cell Background", #selector(melonPanClearTableCellBackground(_:)), to: tableMenu)
        tableMenu.addItem(.separator())
        addMenuItem("Thin Borders", #selector(melonPanSetTableCellBorderThin(_:)), to: tableMenu)
        let tableEdgeMenu = NSMenu()
        addMenuItem("Top Border", #selector(melonPanSetTableCellTopBorderThin(_:)), to: tableEdgeMenu)
        addMenuItem("Right Border", #selector(melonPanSetTableCellRightBorderThin(_:)), to: tableEdgeMenu)
        addMenuItem("Bottom Border", #selector(melonPanSetTableCellBottomBorderThin(_:)), to: tableEdgeMenu)
        addMenuItem("Left Border", #selector(melonPanSetTableCellLeftBorderThin(_:)), to: tableEdgeMenu)
        tableEdgeMenu.addItem(.separator())
        addMenuItem("Clear Top Border", #selector(melonPanClearTableCellTopBorder(_:)), to: tableEdgeMenu)
        addMenuItem("Clear Right Border", #selector(melonPanClearTableCellRightBorder(_:)), to: tableEdgeMenu)
        addMenuItem("Clear Bottom Border", #selector(melonPanClearTableCellBottomBorder(_:)), to: tableEdgeMenu)
        addMenuItem("Clear Left Border", #selector(melonPanClearTableCellLeftBorder(_:)), to: tableEdgeMenu)
        addSubmenu("Thin Edge Border", tableEdgeMenu, to: tableMenu)
        addMenuItem("Choose Border Color...", #selector(melonPanChooseTableCellBorderColor(_:)), to: tableMenu)
        let tableBorderStyleMenu = NSMenu()
        addMenuItem("Solid", #selector(melonPanSetTableCellBorderSolid(_:)), to: tableBorderStyleMenu)
        addMenuItem("Dotted", #selector(melonPanSetTableCellBorderDotted(_:)), to: tableBorderStyleMenu)
        addMenuItem("Dashed", #selector(melonPanSetTableCellBorderDashed(_:)), to: tableBorderStyleMenu)
        addSubmenu("Border Style", tableBorderStyleMenu, to: tableMenu)
        addMenuItem("Clear Borders", #selector(melonPanClearTableCellBorder(_:)), to: tableMenu)
        let tableVerticalAlignmentMenu = NSMenu()
        addMenuItem("Top", #selector(melonPanAlignTableCellTop(_:)), to: tableVerticalAlignmentMenu)
        addMenuItem("Middle", #selector(melonPanAlignTableCellMiddle(_:)), to: tableVerticalAlignmentMenu)
        addMenuItem("Bottom", #selector(melonPanAlignTableCellBottom(_:)), to: tableVerticalAlignmentMenu)
        tableVerticalAlignmentMenu.addItem(.separator())
        addMenuItem(
            "Clear Vertical Alignment",
            #selector(melonPanClearTableCellVerticalAlignment(_:)),
            to: tableVerticalAlignmentMenu
        )
        addSubmenu("Vertical Alignment", tableVerticalAlignmentMenu, to: tableMenu)
        addMenuItem("Set Column Width...", #selector(melonPanSetTableColumnWidth(_:)), to: tableMenu)
        addMenuItem("Set Row Height...", #selector(melonPanSetTableRowHeight(_:)), to: tableMenu)
        addMenuItem("Increase Padding", #selector(melonPanIncreaseTableCellPadding(_:)), to: tableMenu)
        addMenuItem("Decrease Padding", #selector(melonPanDecreaseTableCellPadding(_:)), to: tableMenu)
        addMenuItem("Clear Padding", #selector(melonPanClearTableCellPadding(_:)), to: tableMenu)
        tableMenu.addItem(.separator())
        addMenuItem("Merge Selected Cells", #selector(melonPanMergeSelectedTableCells(_:)), to: tableMenu)
        addMenuItem("Unmerge Cell", #selector(melonPanUnmergeTableCell(_:)), to: tableMenu)
        addMenuItem("Delete Table", #selector(melonPanDeleteTable(_:)), to: tableMenu)
        addSubmenu("Table", tableMenu, to: menu)
    }

    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        switch item.action {
        case #selector(melonPanToggleBold(_:)):
            setMenuState(item, selectionHasFontTrait(.bold) ? .on : .off)
            return canApplyInlineStyle
        case #selector(melonPanToggleItalic(_:)):
            setMenuState(item, selectionHasFontTrait(.italic) ? .on : .off)
            return canApplyInlineStyle
        case #selector(melonPanToggleUnderline(_:)):
            setMenuState(item, selectionHasUnderline ? .on : .off)
            return canApplyInlineStyle
        case #selector(melonPanClearFormatting(_:)),
             #selector(melonPanShowFontPanel(_:)),
             #selector(melonPanIncreaseFontSize(_:)),
             #selector(melonPanDecreaseFontSize(_:)),
             #selector(melonPanChooseTextColor(_:)),
             #selector(melonPanChooseTextBackgroundColor(_:)),
             #selector(melonPanClearFontAndColors(_:)):
            setMenuState(item, .off)
            return canApplyInlineStyle
        case #selector(melonPanSetFontFamilyTimes(_:)):
            setMenuState(item, selectionHasFontFamily("Times New Roman") ? .on : .off)
            return canApplyInlineStyle
        case #selector(melonPanSetTextColorRed(_:)):
            setMenuState(item, selectionHasColor(.foregroundColor, red: 0.8, green: 0.1, blue: 0.1) ? .on : .off)
            return canApplyInlineStyle
        case #selector(melonPanSetTextBackgroundYellow(_:)):
            setMenuState(item, selectionHasColor(.backgroundColor, red: 1.0, green: 0.9, blue: 0.2) ? .on : .off)
            return canApplyInlineStyle
        case #selector(melonPanCreateLink(_:)):
            setMenuState(item, selectionHasLink ? .on : .off)
            return canApplySelectionStyle
        case #selector(melonPanInsertInlineImage(_:)):
            setMenuState(item, .off)
            return canApplyParagraphCommand
        case #selector(melonPanDeleteInlineObject(_:)):
            setMenuState(item, .off)
            return isSelectionOnInlineObject
        case #selector(melonPanCreateHeader(_:)),
             #selector(melonPanCreateFooter(_:)):
            setMenuState(item, .off)
            return canApplyParagraphCommand
        case #selector(melonPanCreateFootnote(_:)):
            setMenuState(item, .off)
            return canApplyParagraphCommand && currentSegmentKind == nil
        case #selector(melonPanDeleteCurrentHeader(_:)):
            setMenuState(item, .off)
            return currentSegmentKind == "header"
        case #selector(melonPanDeleteCurrentFooter(_:)):
            setMenuState(item, .off)
            return currentSegmentKind == "footer"
        case #selector(melonPanDeleteCurrentFootnote(_:)):
            setMenuState(item, .off)
            return currentSegmentKind == "footnote"
        case #selector(melonPanAlignLeft(_:)):
            setMenuState(item, currentParagraphAlignment == .left ? .on : .off)
            return canApplyParagraphCommand
        case #selector(melonPanAlignCenter(_:)):
            setMenuState(item, currentParagraphAlignment == .center ? .on : .off)
            return canApplyParagraphCommand
        case #selector(melonPanAlignRight(_:)):
            setMenuState(item, currentParagraphAlignment == .right ? .on : .off)
            return canApplyParagraphCommand
        case #selector(melonPanAlignJustified(_:)):
            setMenuState(item, currentParagraphAlignment == .justified ? .on : .off)
            return canApplyParagraphCommand
        case #selector(melonPanSetParagraphNormal(_:)),
             #selector(melonPanSetParagraphTitle(_:)),
             #selector(melonPanSetHeading1(_:)),
             #selector(melonPanSetHeading2(_:)),
             #selector(melonPanSetHeading3(_:)),
             #selector(melonPanSetHeading4(_:)),
             #selector(melonPanSetHeading5(_:)),
             #selector(melonPanSetHeading6(_:)):
            setMenuState(item, .off)
            return canApplyParagraphCommand
        case #selector(melonPanToggleNumberedList(_:)),
             #selector(melonPanToggleBulletedList(_:)):
            setMenuState(item, currentParagraphInList ? .on : .off)
            return canApplyParagraphCommand
        case #selector(melonPanInsertTable(_:)):
            setMenuState(item, .off)
            return canApplyParagraphCommand && !isSelectionInTable
        case #selector(melonPanInsertTableRowAbove(_:)),
             #selector(melonPanInsertTableRowBelow(_:)),
             #selector(melonPanDeleteTableRow(_:)),
             #selector(melonPanInsertTableColumnLeft(_:)),
             #selector(melonPanInsertTableColumnRight(_:)),
             #selector(melonPanDeleteTableColumn(_:)),
             #selector(melonPanDeleteTable(_:)),
             #selector(melonPanSetTableCellBackgroundYellow(_:)),
             #selector(melonPanChooseTableCellBackgroundColor(_:)),
             #selector(melonPanClearTableCellBackground(_:)),
             #selector(melonPanSetTableCellBorderThin(_:)),
             #selector(melonPanSetTableCellTopBorderThin(_:)),
             #selector(melonPanSetTableCellRightBorderThin(_:)),
             #selector(melonPanSetTableCellBottomBorderThin(_:)),
             #selector(melonPanSetTableCellLeftBorderThin(_:)),
             #selector(melonPanChooseTableCellBorderColor(_:)),
             #selector(melonPanSetTableCellBorderSolid(_:)),
             #selector(melonPanSetTableCellBorderDotted(_:)),
             #selector(melonPanSetTableCellBorderDashed(_:)),
             #selector(melonPanClearTableCellBorder(_:)),
             #selector(melonPanClearTableCellTopBorder(_:)),
             #selector(melonPanClearTableCellRightBorder(_:)),
             #selector(melonPanClearTableCellBottomBorder(_:)),
             #selector(melonPanClearTableCellLeftBorder(_:)),
             #selector(melonPanAlignTableCellTop(_:)),
             #selector(melonPanAlignTableCellMiddle(_:)),
             #selector(melonPanAlignTableCellBottom(_:)),
             #selector(melonPanClearTableCellVerticalAlignment(_:)),
             #selector(melonPanSetTableColumnWidth(_:)),
             #selector(melonPanSetTableRowHeight(_:)),
             #selector(melonPanIncreaseTableCellPadding(_:)),
             #selector(melonPanDecreaseTableCellPadding(_:)),
             #selector(melonPanClearTableCellPadding(_:)),
             #selector(melonPanMergeSelectedTableCells(_:)),
             #selector(melonPanUnmergeTableCell(_:)):
            setMenuState(item, .off)
            return isSelectionInTable
        default:
            return super.validateUserInterfaceItem(item)
        }
    }

    private func tryToggleList(ordered: Bool) -> Bool {
        // List ops apply to a paragraph at the caret; selection length
        // is irrelevant. Emit even when there is no selection (caret-only).
        guard selectedRange().location != NSNotFound else { return false }
        emitStyleCommand?(ordered ? .toggleNumberedList : .toggleBulletedList)
        return true
    }

    @objc func melonPanToggleBold(_ sender: Any?) {
        _ = tryEmit(.bold)
    }

    @objc func melonPanToggleItalic(_ sender: Any?) {
        _ = tryEmit(.italic)
    }

    @objc func melonPanToggleUnderline(_ sender: Any?) {
        _ = tryEmit(.underline)
    }

    @objc func melonPanClearFormatting(_ sender: Any?) {
        _ = tryEmit(.clearFormatting)
    }

    @objc func melonPanCreateLink(_ sender: Any?) {
        _ = tryPromptForLink()
    }

    @objc func melonPanInsertInlineImage(_ sender: Any?) {
        _ = tryPromptForInlineImage()
    }

    @objc func melonPanDeleteInlineObject(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteInlineObject)
    }

    @objc func melonPanCreateHeader(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.createHeader)
    }

    @objc func melonPanDeleteCurrentHeader(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteCurrentHeader)
    }

    @objc func melonPanCreateFooter(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.createFooter)
    }

    @objc func melonPanDeleteCurrentFooter(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteCurrentFooter)
    }

    @objc func melonPanCreateFootnote(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.createFootnote)
    }

    @objc func melonPanDeleteCurrentFootnote(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteCurrentFootnote)
    }

    @objc func melonPanSetFontFamilyTimes(_ sender: Any?) {
        _ = tryEmit(.setFontFamilyTimes)
    }

    @objc func melonPanShowFontPanel(_ sender: Any?) {
        guard canApplyInlineStyle else { return }
        let fontManager = NSFontManager.shared
        fontManager.target = self
        fontManager.setSelectedFont(selectedFontForPanel ?? currentTypingFont, isMultiple: false)
        fontManager.orderFrontFontPanel(sender)
    }

    override func changeFont(_ sender: Any?) {
        guard canApplyInlineStyle else { return }
        let fontManager = (sender as? NSFontManager) ?? NSFontManager.shared
        let base = selectedFontForPanel ?? currentTypingFont
        let converted = fontManager.convert(base)
        let familyName = converted.familyName ?? converted.fontName
        _ = tryEmit(.setFont(familyName: familyName, sizePt: Double(converted.pointSize)))
    }

    @objc func melonPanIncreaseFontSize(_ sender: Any?) {
        _ = tryEmit(.increaseFontSize)
    }

    @objc func melonPanDecreaseFontSize(_ sender: Any?) {
        _ = tryEmit(.decreaseFontSize)
    }

    @objc func melonPanSetTextColorRed(_ sender: Any?) {
        _ = tryEmit(.setTextColorRed)
    }

    @objc func melonPanSetTextBackgroundYellow(_ sender: Any?) {
        _ = tryEmit(.setTextBackgroundYellow)
    }

    @objc func melonPanChooseTextColor(_ sender: Any?) {
        _ = tryPromptForColor(target: .foreground)
    }

    @objc func melonPanChooseTextBackgroundColor(_ sender: Any?) {
        _ = tryPromptForColor(target: .background)
    }

    @objc func melonPanClearFontAndColors(_ sender: Any?) {
        _ = tryEmit(.clearFontAndColors)
    }

    @objc func melonPanAlignLeft(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.alignLeft)
    }

    @objc func melonPanAlignCenter(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.alignCenter)
    }

    @objc func melonPanAlignRight(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.alignRight)
    }

    @objc func melonPanAlignJustified(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.alignJustified)
    }

    @objc func melonPanSetParagraphNormal(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("NORMAL_TEXT"))
    }

    @objc func melonPanSetParagraphTitle(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("TITLE"))
    }

    @objc func melonPanSetHeading1(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("HEADING_1"))
    }

    @objc func melonPanSetHeading2(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("HEADING_2"))
    }

    @objc func melonPanSetHeading3(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("HEADING_3"))
    }

    @objc func melonPanSetHeading4(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("HEADING_4"))
    }

    @objc func melonPanSetHeading5(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("HEADING_5"))
    }

    @objc func melonPanSetHeading6(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setParagraphNamedStyle("HEADING_6"))
    }

    @objc func melonPanToggleNumberedList(_ sender: Any?) {
        _ = tryToggleList(ordered: true)
    }

    @objc func melonPanToggleBulletedList(_ sender: Any?) {
        _ = tryToggleList(ordered: false)
    }

    @objc func melonPanInsertTable(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.insertTable(rows: 2, columns: 2))
    }

    @objc func melonPanInsertTableRowAbove(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.insertTableRowAbove)
    }

    @objc func melonPanInsertTableRowBelow(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.insertTableRowBelow)
    }

    @objc func melonPanDeleteTableRow(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteTableRow)
    }

    @objc func melonPanInsertTableColumnLeft(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.insertTableColumnLeft)
    }

    @objc func melonPanInsertTableColumnRight(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.insertTableColumnRight)
    }

    @objc func melonPanDeleteTableColumn(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteTableColumn)
    }

    @objc func melonPanDeleteTable(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.deleteTable)
    }

    @objc func melonPanSetTableCellBackgroundYellow(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellBackgroundYellow)
    }

    @objc func melonPanChooseTableCellBackgroundColor(_ sender: Any?) {
        _ = tryPromptForTableCellBackgroundColor()
    }

    @objc func melonPanClearTableCellBackground(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellBackground)
    }

    @objc func melonPanSetTableCellBorderThin(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellBorderThin)
    }

    @objc func melonPanChooseTableCellBorderColor(_ sender: Any?) {
        _ = tryPromptForTableCellBorderColor()
    }

    @objc func melonPanSetTableCellBorderSolid(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellBorderDashStyle("SOLID"))
    }

    @objc func melonPanSetTableCellBorderDotted(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellBorderDashStyle("DOT"))
    }

    @objc func melonPanSetTableCellBorderDashed(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellBorderDashStyle("DASH"))
    }

    @objc func melonPanSetTableCellTopBorderThin(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellTopBorderThin)
    }

    @objc func melonPanSetTableCellRightBorderThin(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellRightBorderThin)
    }

    @objc func melonPanSetTableCellBottomBorderThin(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellBottomBorderThin)
    }

    @objc func melonPanSetTableCellLeftBorderThin(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellLeftBorderThin)
    }

    @objc func melonPanClearTableCellBorder(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellBorder)
    }

    @objc func melonPanClearTableCellTopBorder(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellTopBorder)
    }

    @objc func melonPanClearTableCellRightBorder(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellRightBorder)
    }

    @objc func melonPanClearTableCellBottomBorder(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellBottomBorder)
    }

    @objc func melonPanClearTableCellLeftBorder(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellLeftBorder)
    }

    @objc func melonPanAlignTableCellTop(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellVerticalAlignment("TOP"))
    }

    @objc func melonPanAlignTableCellMiddle(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellVerticalAlignment("MIDDLE"))
    }

    @objc func melonPanAlignTableCellBottom(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.setTableCellVerticalAlignment("BOTTOM"))
    }

    @objc func melonPanClearTableCellVerticalAlignment(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellVerticalAlignment)
    }

    @objc func melonPanSetTableColumnWidth(_ sender: Any?) {
        _ = tryPromptForTableDimension(
            title: "Set column width",
            message: "Width in points",
            defaultValue: 120,
            command: { .resizeTableColumn(widthPt: $0) }
        )
    }

    @objc func melonPanSetTableRowHeight(_ sender: Any?) {
        _ = tryPromptForTableDimension(
            title: "Set row height",
            message: "Minimum height in points",
            defaultValue: 28,
            command: { .resizeTableRow(minHeightPt: $0) }
        )
    }

    @objc func melonPanIncreaseTableCellPadding(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.increaseTableCellPadding)
    }

    @objc func melonPanDecreaseTableCellPadding(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.decreaseTableCellPadding)
    }

    @objc func melonPanClearTableCellPadding(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.clearTableCellPadding)
    }

    @objc func melonPanMergeSelectedTableCells(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.mergeSelectedTableCells)
    }

    @objc func melonPanUnmergeTableCell(_ sender: Any?) {
        _ = tryEmitParagraphCommand(.unmergeTableCell)
    }

    private func tryUpdateListNesting(delta: Int) -> Bool {
        guard selectedRange().location != NSNotFound else { return false }
        guard let storage = textStorage, storage.length > 0 else { return false }
        let probe = min(selectedRange().location, max(0, storage.length - 1))
        let inList = (storage.attribute(
            .melonPanParagraphInList,
            at: probe,
            effectiveRange: nil
        ) as? Bool) ?? false
        guard inList else { return false }
        emitStyleCommand?(delta > 0 ? .listIndent : .listOutdent)
        return true
    }

    private func tryMoveSelectionToAdjacentTableCell(reverse: Bool) -> Bool {
        guard let current = tableCellAtSelection(),
              let storage = textStorage,
              storage.length > 0 else {
            return false
        }

        var anchors: [TableCellAnchor] = []
        let fullRange = NSRange(location: 0, length: storage.length)
        storage.enumerateAttribute(.melonPanTableId, in: fullRange) { value, range, _ in
            guard value as? String == current.tableId,
                  let anchor = tableCellAnchor(at: range.location, in: storage) else {
                return
            }
            if let index = anchors.firstIndex(where: {
                $0.row == anchor.row && $0.column == anchor.column
            }) {
                let merged = NSUnionRange(anchors[index].range, range)
                anchors[index] = TableCellAnchor(
                    tableId: current.tableId,
                    row: anchor.row,
                    column: anchor.column,
                    range: merged
                )
            } else {
                anchors.append(anchor)
            }
        }

        anchors.sort {
            if $0.row == $1.row {
                return $0.column < $1.column
            }
            return $0.row < $1.row
        }
        guard let currentIndex = anchors.firstIndex(where: {
            $0.row == current.row && $0.column == current.column
        }), !anchors.isEmpty else {
            return false
        }

        let targetIndex: Int
        if reverse {
            targetIndex = currentIndex == 0 ? anchors.count - 1 : currentIndex - 1
        } else {
            targetIndex = currentIndex == anchors.count - 1 ? 0 : currentIndex + 1
        }
        let target = anchors[targetIndex]
        let caret = NSRange(location: target.range.location, length: 0)
        setSelectedRange(caret)
        scrollRangeToVisible(caret)
        return true
    }

    private func tryEmit(_ command: StyleCommand) -> Bool {
        guard hasNonEmptySelection || command.canApplyAtInsertionPoint else { return false }
        emitStyleCommand?(command)
        return true
    }

    private func tryEmitParagraphCommand(_ command: StyleCommand) -> Bool {
        guard selectedRange().location != NSNotFound else { return false }
        emitStyleCommand?(command)
        return true
    }

    private func tryPromptForLink() -> Bool {
        guard hasNonEmptySelection else { return false }
        let alert = NSAlert()
        alert.messageText = "Add link"
        alert.informativeText = "Enter the URL to link this selection to."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.placeholderString = "https://example.com"
        alert.accessoryView = field
        alert.addButton(withTitle: "Add link")
        alert.addButton(withTitle: "Cancel")
        if let window = self.window {
            alert.beginSheetModal(for: window) { [weak self] response in
                guard response == .alertFirstButtonReturn else { return }
                let raw = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !raw.isEmpty else { return }
                self?.emitStyleCommand?(.link(url: raw))
            }
        } else {
            let response = alert.runModal()
            guard response == .alertFirstButtonReturn else { return true }
            let raw = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !raw.isEmpty else { return true }
            emitStyleCommand?(.link(url: raw))
        }
        return true
    }

    private func tryPromptForInlineImage() -> Bool {
        guard selectedRange().location != NSNotFound else { return false }
        let alert = NSAlert()
        alert.messageText = "Insert image"
        alert.informativeText = "Enter a publicly reachable image URL."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        field.placeholderString = "https://example.com/image.png"
        alert.accessoryView = field
        alert.addButton(withTitle: "Insert")
        alert.addButton(withTitle: "Cancel")

        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            let raw = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URL(string: raw),
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https"].contains(scheme) else {
                return
            }
            self?.emitStyleCommand?(.insertInlineImage(uri: raw))
        }

        if let window {
            alert.beginSheetModal(for: window, completionHandler: handle)
        } else {
            handle(alert.runModal())
        }
        return true
    }

    private enum TextColorTarget: Equatable {
        case foreground
        case background
    }

    private func tryPromptForColor(target: TextColorTarget) -> Bool {
        guard hasNonEmptySelection else { return false }
        let alert = NSAlert()
        alert.messageText = target == .foreground ? "Choose text color" : "Choose highlight color"
        alert.informativeText = "Pick the color to apply to the current selection."
        let colorWell = NSColorWell(frame: NSRect(x: 0, y: 0, width: 120, height: 32))
        colorWell.color = selectedColor(for: target) ?? (target == .foreground ? .labelColor : .yellow)
        colorWell.isBordered = true
        alert.accessoryView = colorWell
        alert.addButton(withTitle: "Apply")
        alert.addButton(withTitle: "Cancel")

        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .alertFirstButtonReturn,
                  let rgb = Self.rgbColor(from: colorWell.color) else {
                return
            }
            switch target {
            case .foreground:
                self?.emitStyleCommand?(.setTextColor(rgb))
            case .background:
                self?.emitStyleCommand?(.setTextBackgroundColor(rgb))
            }
        }

        if let window {
            alert.beginSheetModal(for: window, completionHandler: handle)
        } else {
            handle(alert.runModal())
        }
        return true
    }

    private func tryPromptForTableCellBackgroundColor() -> Bool {
        guard selectedRange().location != NSNotFound,
              tableCellAtSelection() != nil else {
            return false
        }
        let alert = NSAlert()
        alert.messageText = "Choose cell background"
        alert.informativeText = "Pick the background color for the current table cell."
        let colorWell = NSColorWell(frame: NSRect(x: 0, y: 0, width: 120, height: 32))
        colorWell.color = selectedTableCellBackgroundColor ?? .yellow
        colorWell.isBordered = true
        alert.accessoryView = colorWell
        alert.addButton(withTitle: "Apply")
        alert.addButton(withTitle: "Cancel")

        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .alertFirstButtonReturn,
                  let rgb = Self.rgbColor(from: colorWell.color) else {
                return
            }
            self?.emitStyleCommand?(.setTableCellBackgroundColor(rgb))
        }

        if let window {
            alert.beginSheetModal(for: window, completionHandler: handle)
        } else {
            handle(alert.runModal())
        }
        return true
    }

    private func tryPromptForTableCellBorderColor() -> Bool {
        guard selectedRange().location != NSNotFound,
              tableCellAtSelection() != nil else {
            return false
        }
        let alert = NSAlert()
        alert.messageText = "Choose border color"
        alert.informativeText = "Pick the border color for the current table cell."
        let colorWell = NSColorWell(frame: NSRect(x: 0, y: 0, width: 120, height: 32))
        colorWell.color = .separatorColor
        colorWell.isBordered = true
        alert.accessoryView = colorWell
        alert.addButton(withTitle: "Apply")
        alert.addButton(withTitle: "Cancel")

        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .alertFirstButtonReturn,
                  let rgb = Self.rgbColor(from: colorWell.color) else {
                return
            }
            self?.emitStyleCommand?(.setTableCellBorderColor(rgb))
        }

        if let window {
            alert.beginSheetModal(for: window, completionHandler: handle)
        } else {
            handle(alert.runModal())
        }
        return true
    }

    private func tryPromptForTableDimension(
        title: String,
        message: String,
        defaultValue: Double,
        command: @escaping (Double) -> StyleCommand
    ) -> Bool {
        guard selectedRange().location != NSNotFound,
              tableCellAtSelection() != nil else {
            return false
        }
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 120, height: 24))
        input.stringValue = String(Int(defaultValue))
        alert.accessoryView = input
        alert.addButton(withTitle: "Apply")
        alert.addButton(withTitle: "Cancel")

        let handle: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .alertFirstButtonReturn,
                  let value = Double(input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)),
                  value.isFinite else {
                return
            }
            self?.emitStyleCommand?(command(value))
        }

        if let window {
            alert.beginSheetModal(for: window, completionHandler: handle)
        } else {
            handle(alert.runModal())
        }
        return true
    }

    private var hasNonEmptySelection: Bool {
        let range = selectedRange()
        return range.length > 0 && range.location != NSNotFound
    }

    private var canApplySelectionStyle: Bool {
        isEditable && selectedStyleRange != nil
    }

    private var canApplyInlineStyle: Bool {
        isEditable && selectedRange().location != NSNotFound
    }

    private var canApplyParagraphCommand: Bool {
        isEditable && selectedRange().location != NSNotFound
    }

    private var selectedStyleRange: NSRange? {
        guard hasNonEmptySelection, let storage = textStorage else { return nil }
        let range = selectedRange()
        guard NSMaxRange(range) <= storage.length else { return nil }
        return range
    }

    private var selectionHasUnderline: Bool {
        selectionAttributesSatisfy { attrs in
            guard let style = attrs[.underlineStyle] as? Int else { return false }
            return style != 0
        }
    }

    private var selectionHasLink: Bool {
        selectionAttributesSatisfy { attrs in
            attrs[.link] != nil
        }
    }

    private var currentParagraphAlignment: NSTextAlignment {
        guard let storage = textStorage, storage.length > 0 else { return .left }
        let location = min(selectedRange().location, storage.length - 1)
        return (storage.attribute(
            .paragraphStyle,
            at: location,
            effectiveRange: nil
        ) as? NSParagraphStyle)?.alignment ?? .left
    }

    private var currentParagraphInList: Bool {
        guard let storage = textStorage, storage.length > 0 else { return false }
        let location = min(selectedRange().location, storage.length - 1)
        return (storage.attribute(
            .melonPanParagraphInList,
            at: location,
            effectiveRange: nil
        ) as? Bool) ?? false
    }

    private var isSelectionInTable: Bool {
        tableCellAtSelection() != nil
    }

    private var isSelectionOnInlineObject: Bool {
        guard let storage = textStorage, storage.length > 0 else { return false }
        let location = selectedRange().location
        guard location != NSNotFound else { return false }
        let clamped = min(location, storage.length - 1)
        return storage.attribute(.melonPanInlineObjectId, at: clamped, effectiveRange: nil) != nil
            || (clamped > 0 && storage.attribute(
                .melonPanInlineObjectId,
                at: clamped - 1,
                effectiveRange: nil
            ) != nil)
    }

    private var currentSegmentKind: String? {
        guard let storage = textStorage, storage.length > 0 else { return nil }
        let location = selectedRange().location
        guard location != NSNotFound else { return nil }
        let clamped = min(location, storage.length - 1)
        return storage.attribute(.melonPanSegmentKind, at: clamped, effectiveRange: nil) as? String
            ?? (clamped > 0 ? storage.attribute(
                .melonPanSegmentKind,
                at: clamped - 1,
                effectiveRange: nil
            ) as? String : nil)
    }

    private var selectedTableCellBackgroundColor: NSColor? {
        guard let storage = textStorage,
              let anchor = tableCellAtSelection(),
              anchor.range.location < storage.length else {
            return nil
        }
        return storage.attribute(
            .backgroundColor,
            at: anchor.range.location,
            effectiveRange: nil
        ) as? NSColor
    }

    private var selectedFontForPanel: NSFont? {
        guard let storage = textStorage,
              let range = selectedStyleRange,
              range.location < storage.length else {
            return nil
        }
        return storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont
    }

    private var currentTypingFont: NSFont {
        if let font = typingAttributes[.font] as? NSFont {
            return font
        }
        guard let storage = textStorage, storage.length > 0 else {
            return NSFont.systemFont(ofSize: 14)
        }
        let location = selectedRange().location
        guard location != NSNotFound else {
            return NSFont.systemFont(ofSize: 14)
        }
        let probe = min(max(0, location == storage.length ? location - 1 : location), storage.length - 1)
        return storage.attribute(.font, at: probe, effectiveRange: nil) as? NSFont
            ?? NSFont.systemFont(ofSize: 14)
    }

    private struct TableCellAnchor {
        let tableId: String
        let row: Int
        let column: Int
        let range: NSRange
    }

    private enum TableResizeEdge {
        case column
        case row
    }

    private struct TableResizeDrag {
        let edge: TableResizeEdge
        let startPoint: NSPoint
        var currentPoint: NSPoint
        let startDimension: Double
    }

    private func drawTableResizeHandles() {
        guard isEditable,
              selectedRange().location != NSNotFound,
              let cellRect = selectedTableCellRect() else {
            return
        }
        NSColor.controlAccentColor.withAlphaComponent(0.86).setFill()
        rightResizeHandle(in: cellRect).fill()
        bottomResizeHandle(in: cellRect).fill()
        if let drag = activeTableResizeDrag {
            NSColor.controlAccentColor.withAlphaComponent(0.22).setFill()
            switch drag.edge {
            case .column:
                let delta = drag.currentPoint.x - drag.startPoint.x
                NSRect(
                    x: cellRect.maxX + delta - 1,
                    y: cellRect.minY,
                    width: 2,
                    height: cellRect.height
                ).fill()
            case .row:
                let delta = drag.currentPoint.y - drag.startPoint.y
                NSRect(
                    x: cellRect.minX,
                    y: cellRect.maxY + delta - 1,
                    width: cellRect.width,
                    height: 2
                ).fill()
            }
        }
    }

    private func tableResizeDrag(at point: NSPoint) -> TableResizeDrag? {
        guard let cellRect = selectedTableCellRect() else { return nil }
        if rightResizeHandle(in: cellRect).insetBy(dx: -3, dy: -6).contains(point) {
            return TableResizeDrag(
                edge: .column,
                startPoint: point,
                currentPoint: point,
                startDimension: Double(cellRect.width)
            )
        }
        if bottomResizeHandle(in: cellRect).insetBy(dx: -6, dy: -3).contains(point) {
            return TableResizeDrag(
                edge: .row,
                startPoint: point,
                currentPoint: point,
                startDimension: Double(cellRect.height)
            )
        }
        return nil
    }

    private func selectedTableCellRect() -> NSRect? {
        guard let anchor = tableCellAtSelection(),
              let layoutManager,
              let textContainer else {
            return nil
        }
        var actual = NSRange(location: 0, length: 0)
        let glyphRange = layoutManager.glyphRange(
            forCharacterRange: anchor.range,
            actualCharacterRange: &actual
        )
        guard glyphRange.location != NSNotFound else { return nil }
        layoutManager.ensureLayout(for: textContainer)
        var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
        rect.origin.x += textContainerOrigin.x
        rect.origin.y += textContainerOrigin.y
        if rect.width < 8 || rect.height < 8 { return nil }
        return rect.insetBy(dx: -2, dy: -2)
    }

    private func rightResizeHandle(in rect: NSRect) -> NSRect {
        NSRect(x: rect.maxX - 3, y: rect.midY - 12, width: 6, height: 24)
    }

    private func bottomResizeHandle(in rect: NSRect) -> NSRect {
        NSRect(x: rect.midX - 18, y: rect.maxY - 3, width: 36, height: 6)
    }

    private func tableCellAtSelection() -> TableCellAnchor? {
        guard let storage = textStorage, storage.length > 0 else { return nil }
        let location = selectedRange().location
        guard location != NSNotFound else { return nil }
        let clamped = min(location, storage.length - 1)
        if let anchor = tableCellAnchor(at: clamped, in: storage) {
            return anchor
        }
        if clamped > 0 {
            return tableCellAnchor(at: clamped - 1, in: storage)
        }
        return nil
    }

    private func tableCellAnchor(
        at location: Int,
        in storage: NSTextStorage
    ) -> TableCellAnchor? {
        guard location >= 0, location < storage.length,
              let tableId = storage.attribute(
                .melonPanTableId,
                at: location,
                effectiveRange: nil
              ) as? String,
              let row = storage.attribute(
                .melonPanTableRowIndex,
                at: location,
                effectiveRange: nil
              ) as? Int,
              let column = storage.attribute(
                .melonPanTableColumnIndex,
                at: location,
                effectiveRange: nil
              ) as? Int else {
            return nil
        }
        var effectiveRange = NSRange(location: location, length: 0)
        _ = storage.attribute(
            .melonPanTableColumnIndex,
            at: location,
            longestEffectiveRange: &effectiveRange,
            in: NSRange(location: 0, length: storage.length)
        )
        return TableCellAnchor(
            tableId: tableId,
            row: row,
            column: column,
            range: effectiveRange
        )
    }

    private func isTableLocation(_ location: Int) -> Bool {
        guard let storage = textStorage, storage.length > 0 else { return false }
        let clamped = min(max(0, location), storage.length - 1)
        return tableCellAnchor(at: clamped, in: storage) != nil
            || (clamped > 0 && tableCellAnchor(at: clamped - 1, in: storage) != nil)
    }

    private func characterIndex(for event: NSEvent) -> Int? {
        guard let layoutManager, let textContainer else { return nil }
        var point = convert(event.locationInWindow, from: nil)
        point.x -= textContainerOrigin.x
        point.y -= textContainerOrigin.y
        let glyphIndex = layoutManager.glyphIndex(for: point, in: textContainer)
        guard glyphIndex < layoutManager.numberOfGlyphs else { return nil }
        return layoutManager.characterIndexForGlyph(at: glyphIndex)
    }

    private func ensureRightClickSelection(for location: Int?) {
        guard let location,
              textStorage?.length ?? 0 > 0,
              selectedRange().location != NSNotFound else {
            return
        }
        let selection = selectedRange()
        if selection.length > 0, NSLocationInRange(location, selection) {
            return
        }
        setSelectedRange(NSRange(location: min(location, max(0, (textStorage?.length ?? 1) - 1)), length: 0))
    }

    private func addMenuItem(_ title: String, _ action: Selector, to menu: NSMenu) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        menu.addItem(item)
    }

    private func addSubmenu(_ title: String, _ submenu: NSMenu, to menu: NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        menu.addItem(item)
    }

    private func selectionHasFontTrait(_ trait: NSFontDescriptor.SymbolicTraits) -> Bool {
        selectionAttributesSatisfy { attrs in
            guard let font = attrs[.font] as? NSFont else { return false }
            return font.fontDescriptor.symbolicTraits.contains(trait)
        }
    }

    private func selectionHasFontFamily(_ family: String) -> Bool {
        selectionAttributesSatisfy { attrs in
            guard let font = attrs[.font] as? NSFont,
                  let familyName = font.familyName else {
                return false
            }
            return familyName.caseInsensitiveCompare(family) == .orderedSame
        }
    }

    private func selectionHasColor(
        _ key: NSAttributedString.Key,
        red: CGFloat,
        green: CGFloat,
        blue: CGFloat
    ) -> Bool {
        selectionAttributesSatisfy { attrs in
            guard let color = attrs[key] as? NSColor,
                  let rgb = color.usingColorSpace(.deviceRGB)
                    ?? color.usingColorSpace(.genericRGB) else {
                return false
            }
            return abs(rgb.redComponent - red) < 0.02
                && abs(rgb.greenComponent - green) < 0.02
                && abs(rgb.blueComponent - blue) < 0.02
        }
    }

    private func selectedColor(for target: TextColorTarget) -> NSColor? {
        guard let storage = textStorage,
              let range = selectedStyleRange,
              range.location < storage.length else {
            return nil
        }
        let key: NSAttributedString.Key = target == .foreground ? .foregroundColor : .backgroundColor
        return storage.attribute(key, at: range.location, effectiveRange: nil) as? NSColor
    }

    private static func rgbColor(from color: NSColor) -> StyleCommand.RGBColor? {
        guard let rgb = color.usingColorSpace(.deviceRGB)
            ?? color.usingColorSpace(.genericRGB) else {
            return nil
        }
        func clamp(_ value: CGFloat) -> Double {
            Double(min(1, max(0, value)))
        }
        return StyleCommand.RGBColor(
            red: clamp(rgb.redComponent),
            green: clamp(rgb.greenComponent),
            blue: clamp(rgb.blueComponent)
        )
    }

    private func selectionAttributesSatisfy(
        _ predicate: ([NSAttributedString.Key: Any]) -> Bool
    ) -> Bool {
        guard let storage = textStorage, let range = selectedStyleRange else { return false }
        var matches = true
        storage.enumerateAttributes(in: range) { attrs, _, stop in
            if !predicate(attrs) {
                matches = false
                stop.pointee = true
            }
        }
        return matches
    }

    private func setMenuState(
        _ item: NSValidatedUserInterfaceItem,
        _ state: NSControl.StateValue
    ) {
        (item as? NSMenuItem)?.state = state
    }
}
