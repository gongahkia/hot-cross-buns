import AppKit
import Foundation

/// Renders a `RichDocumentModel` (loaded via FFI) into an
/// `NSAttributedString`. Each paragraph's text carries
/// `.melonPanParagraphId` and `.melonPanParagraphStart` custom
/// attributes so the edit-capture delegate can recover the stable
/// `RichNodeId` and compute a paragraph-local UTF-16 offset.
///
/// Distinct from `DocsJsonAttributedRenderer`, which read raw Docs JSON
/// directly. This renderer is the canonical path now that the FFI gives
/// Swift the parsed RichDocument with stable IDs; the Docs-JSON renderer
/// remains as a fallback when the FFI bridge is unavailable.
enum RichDocumentRenderer {
    /// Render the first tab's body as a single attributed string. V1 only
    /// renders one tab — tab switching is M-next.
    static func render(
        _ document: RichDocumentModel,
        tabIndex: Int = 0,
        baseFontSize: Int = AppSettings.MacExtras.default.editorFontSize
    ) -> NSAttributedString {
        let result = NSMutableAttributedString()
        guard let tab = document.tabs[safe: tabIndex] else {
            return result
        }
        let inlineObjects = Dictionary(
            uniqueKeysWithValues: document.inlineObjects.map { ($0.objectId, $0) }
        )
        if let blocks = tab.blocks {
            for block in blocks {
                renderBlock(
                    block,
                    into: result,
                    inlineObjects: inlineObjects,
                    baseFontSize: baseFontSize
                )
            }
        } else {
            for paragraph in tab.paragraphs {
                renderParagraph(
                    paragraph,
                    into: result,
                    inlineObjects: inlineObjects,
                    baseFontSize: baseFontSize
                )
            }
        }
        renderSupplementarySegments(
            tab.headers ?? [],
            title: "Headers",
            into: result,
            inlineObjects: inlineObjects,
            baseFontSize: baseFontSize
        )
        renderSupplementarySegments(
            tab.footers ?? [],
            title: "Footers",
            into: result,
            inlineObjects: inlineObjects,
            baseFontSize: baseFontSize
        )
        renderSupplementarySegments(
            tab.footnotes ?? [],
            title: "Footnotes",
            into: result,
            inlineObjects: inlineObjects,
            baseFontSize: baseFontSize
        )
        if result.length == 0 {
            return NSAttributedString(
                string: "(empty document)",
                attributes: [.font: NSFont.systemFont(ofSize: 14)]
            )
        }
        return result
    }

    private static func renderParagraph(
        _ paragraph: RichDocumentModel.Paragraph,
        into result: NSMutableAttributedString,
        inlineObjects: [String: RichDocumentModel.InlineObject],
        baseFontSize: Int,
        extraAttributes: [NSAttributedString.Key: Any] = [:],
        terminator: String = "\n",
        paragraphStyleCustomizer: ((NSMutableParagraphStyle) -> Void)? = nil
    ) {
        let paragraphStart = result.length
        let baseFont = font(forNamedStyle: paragraph.namedStyle, baseSize: baseFontSize)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.paragraphSpacingBefore = CGFloat(paragraph.spaceAbove ?? 0)
        paragraphStyle.paragraphSpacing = CGFloat(
            paragraph.spaceBelow ?? Double(paragraphSpacing(for: paragraph.namedStyle))
        )
        paragraphStyle.alignment = textAlignment(for: paragraph.alignment)
        if let lineSpacing = paragraph.lineSpacing, lineSpacing > 0 {
            paragraphStyle.lineHeightMultiple = CGFloat(lineSpacing / 100.0)
        }
        applyIndents(from: paragraph, to: paragraphStyle)
        paragraphStyleCustomizer?(paragraphStyle)

        for run in paragraph.runs {
            var attrs: [NSAttributedString.Key: Any] = [
                .paragraphStyle: paragraphStyle,
                .melonPanParagraphId: paragraph.id.packed,
                .melonPanParagraphStart: paragraphStart,
                .melonPanParagraphInList: paragraph.inList,
                .melonPanListNestingLevel: paragraph.listNestingLevel,
                .melonPanNamedStyle: paragraph.namedStyle
            ]
            attrs.merge(extraAttributes) { _, new in new }

            if let ref = run.inlineObjectRef {
                let object = inlineObjects[ref.objectId]
                attrs[.melonPanInlineObjectId] = ref.objectId
                result.append(InlineImageAttachment.attributedString(
                    objectId: ref.objectId,
                    contentUri: object?.contentUri,
                    altText: object?.altTitle ?? object?.altDescription,
                    attributes: attrs
                ))
                continue
            }

            let baseTraits = baseFont.fontDescriptor.symbolicTraits
            let effectiveBold = run.bold
                || baseTraits.contains(.bold)
                || (run.fontWeight ?? 0) >= 600
            let effectiveItalic = run.italic || baseTraits.contains(.italic)
            attrs[.font] = font(
                family: run.fontFamily,
                size: run.fontSizePt,
                weight: run.fontWeight,
                bold: effectiveBold,
                italic: effectiveItalic,
                fallback: baseFont
            )

            if run.underline {
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            if run.strikethrough {
                attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            }
            if let color = run.foregroundColor {
                attrs[.foregroundColor] = NSColor.richRGB(color)
            }
            if let color = run.backgroundColor {
                attrs[.backgroundColor] = NSColor.richRGB(color)
            }
            if let url = run.linkUrl, !url.isEmpty, let nsUrl = URL(string: url) {
                attrs[.link] = nsUrl
                attrs[.foregroundColor] = NSColor.linkColor
            }
            if paragraph.protected {
                attrs[.foregroundColor] = NSColor.secondaryLabelColor
            }
            if let inlineKind = run.inlineKind {
                applyInlinePlaceholderStyle(kind: inlineKind, attributes: &attrs)
            }

            result.append(NSAttributedString(string: run.text, attributes: attrs))
        }
        // Paragraph terminators carry the same paragraph attributes so
        // the edit-capture delegate can resolve a caret at end-of-
        // paragraph back to the right id.
        let newlineAttrs: [NSAttributedString.Key: Any] = [
            .paragraphStyle: paragraphStyle,
            .font: baseFont,
            .melonPanParagraphId: paragraph.id.packed,
            .melonPanParagraphStart: paragraphStart,
            .melonPanParagraphInList: paragraph.inList,
            .melonPanListNestingLevel: paragraph.listNestingLevel,
            .melonPanNamedStyle: paragraph.namedStyle
        ].merging(extraAttributes) { _, new in new }
        if !terminator.isEmpty {
            result.append(NSAttributedString(string: terminator, attributes: newlineAttrs))
        }
    }

    private static func renderBlock(
        _ block: RichDocumentModel.Block,
        into result: NSMutableAttributedString,
        inlineObjects: [String: RichDocumentModel.InlineObject],
        baseFontSize: Int,
        extraAttributes: [NSAttributedString.Key: Any] = [:]
    ) {
        switch block.kind {
        case "paragraph":
            if let paragraph = block.paragraph {
                renderParagraph(
                    paragraph,
                    into: result,
                    inlineObjects: inlineObjects,
                    baseFontSize: baseFontSize,
                    extraAttributes: extraAttributes
                )
            }
        case "table":
            if let table = block.table {
                renderTable(
                    table,
                    into: result,
                    inlineObjects: inlineObjects,
                    baseFontSize: baseFontSize,
                    extraAttributes: extraAttributes
                )
            }
        default:
            break
        }
    }

    private static func renderTable(
        _ table: RichDocumentModel.Table,
        into result: NSMutableAttributedString,
        inlineObjects: [String: RichDocumentModel.InlineObject],
        baseFontSize: Int,
        extraAttributes: [NSAttributedString.Key: Any] = [:]
    ) {
        let tableFont = NSFont.systemFont(ofSize: CGFloat(max(10, baseFontSize - 1)))
        let separatorAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
            .foregroundColor: NSColor.tertiaryLabelColor,
            .melonPanProtectedRenderRange: true
        ].merging(extraAttributes) { _, new in new }
        let tableAttributes: [NSAttributedString.Key: Any] = [
            .melonPanTableId: table.id.packed
        ].merging(extraAttributes) { _, new in new }
        result.append(NSAttributedString(string: "\n", attributes: separatorAttributes))
        let textTable = NSTextTable()
        textTable.numberOfColumns = max(1, table.columns)
        textTable.layoutAlgorithm = .automaticLayoutAlgorithm

        var occupied = Array(
            repeating: Array(repeating: false, count: max(1, table.columns)),
            count: max(1, table.rows.count)
        )

        for (rowIndex, row) in table.rows.enumerated() {
            var visualColumnIndex = 0
            for cell in row.cells {
                visualColumnIndex = nextFreeColumn(
                    in: occupied,
                    row: rowIndex,
                    startingAt: visualColumnIndex
                )
                var cellAttributes = tableAttributes
                cellAttributes[.font] = tableFont
                cellAttributes[.melonPanTableRowIndex] = rowIndex
                cellAttributes[.melonPanTableColumnIndex] = visualColumnIndex
                cellAttributes[.melonPanTableRowSpan] = cell.rowSpan
                cellAttributes[.melonPanTableColumnSpan] = cell.columnSpan
                if let color = cell.backgroundColor {
                    cellAttributes[.backgroundColor] = NSColor.richRGB(color)
                }
                renderTableCell(
                    cell,
                    textTable: textTable,
                    rowIndex: rowIndex,
                    columnIndex: visualColumnIndex,
                    into: result,
                    inlineObjects: inlineObjects,
                    baseFontSize: baseFontSize,
                    extraAttributes: cellAttributes
                )
                markOccupied(
                    &occupied,
                    row: rowIndex,
                    column: visualColumnIndex,
                    rowSpan: max(1, cell.rowSpan),
                    columnSpan: max(1, cell.columnSpan)
                )
                visualColumnIndex += max(1, cell.columnSpan)
            }
        }
        result.append(NSAttributedString(string: "\n", attributes: separatorAttributes))
    }

    private static func renderTableCell(
        _ cell: RichDocumentModel.TableCell,
        textTable: NSTextTable,
        rowIndex: Int,
        columnIndex: Int,
        into result: NSMutableAttributedString,
        inlineObjects: [String: RichDocumentModel.InlineObject],
        baseFontSize: Int,
        extraAttributes: [NSAttributedString.Key: Any]
    ) {
        let startLength = result.length
        let cellBlock = tableBlock(
            textTable: textTable,
            cell: cell,
            rowIndex: rowIndex,
            columnIndex: columnIndex
        )
        for (index, block) in cell.blocks.enumerated() {
            switch block.kind {
            case "paragraph":
                if let paragraph = block.paragraph {
                    renderParagraph(
                        paragraph,
                        into: result,
                        inlineObjects: inlineObjects,
                        baseFontSize: baseFontSize,
                        extraAttributes: extraAttributes,
                        terminator: "\n",
                        paragraphStyleCustomizer: { style in
                            style.textBlocks = [cellBlock]
                        }
                    )
                }
            case "table":
                if let table = block.table {
                    renderTable(
                        table,
                        into: result,
                        inlineObjects: inlineObjects,
                        baseFontSize: baseFontSize,
                        extraAttributes: extraAttributes
                    )
                }
            default:
                break
            }
            if index < cell.blocks.count - 1 {
                result.append(NSAttributedString(string: "\n", attributes: extraAttributes))
            }
        }
        if result.length == startLength {
            let style = NSMutableParagraphStyle()
            style.textBlocks = [cellBlock]
            var attrs = extraAttributes
            attrs[.paragraphStyle] = style
            result.append(NSAttributedString(string: " \n", attributes: attrs))
        }
    }

    private static func tableBlock(
        textTable: NSTextTable,
        cell: RichDocumentModel.TableCell,
        rowIndex: Int,
        columnIndex: Int
    ) -> NSTextTableBlock {
        let block = NSTextTableBlock(
            table: textTable,
            startingRow: rowIndex,
            rowSpan: max(1, cell.rowSpan),
            startingColumn: columnIndex,
            columnSpan: max(1, cell.columnSpan)
        )
        block.setWidth(CGFloat(cell.borderWidthPt ?? 1), type: .absoluteValueType, for: .border)
        block.setWidth(CGFloat(cell.paddingPt ?? 8), type: .absoluteValueType, for: .padding)
        block.setBorderColor(cell.borderColor.map(NSColor.richRGB) ?? NSColor.separatorColor)
        return block
    }

    private static func nextFreeColumn(
        in occupied: [[Bool]],
        row: Int,
        startingAt column: Int
    ) -> Int {
        guard occupied.indices.contains(row) else { return column }
        var candidate = max(0, column)
        while candidate < occupied[row].count, occupied[row][candidate] {
            candidate += 1
        }
        return candidate
    }

    private static func markOccupied(
        _ occupied: inout [[Bool]],
        row: Int,
        column: Int,
        rowSpan: Int,
        columnSpan: Int
    ) {
        guard row >= 0, column >= 0 else { return }
        for rowOffset in 0..<max(1, rowSpan) {
            let targetRow = row + rowOffset
            guard occupied.indices.contains(targetRow) else { continue }
            for columnOffset in 0..<max(1, columnSpan) {
                let targetColumn = column + columnOffset
                guard occupied[targetRow].indices.contains(targetColumn) else { continue }
                occupied[targetRow][targetColumn] = true
            }
        }
    }

    private static func renderSupplementarySegments(
        _ segments: [RichDocumentModel.Segment],
        title: String,
        into result: NSMutableAttributedString,
        inlineObjects: [String: RichDocumentModel.InlineObject],
        baseFontSize: Int
    ) {
        guard !segments.isEmpty else { return }
        let chromeAttributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: NSColor.secondaryLabelColor,
            .melonPanProtectedRenderRange: true
        ]
        result.append(NSAttributedString(string: "\n\(title)\n", attributes: chromeAttributes))
        for segment in segments {
            result.append(NSAttributedString(
                string: "\(segment.segmentId)\n",
                attributes: chromeAttributes
            ))
            let contentAttributes: [NSAttributedString.Key: Any] = [
                .melonPanSegmentId: segment.segmentId,
                .melonPanSegmentKind: segment.kind
            ]
            for block in segment.blocks {
                renderBlock(
                    block,
                    into: result,
                    inlineObjects: inlineObjects,
                    baseFontSize: baseFontSize,
                    extraAttributes: contentAttributes
                )
            }
        }
    }

    private static func font(forNamedStyle namedStyle: String, baseSize: Int) -> NSFont {
        let delta = CGFloat(baseSize - AppSettings.MacExtras.default.editorFontSize)
        switch namedStyle {
        case "TITLE":     return NSFont.systemFont(ofSize: max(12, 28 + delta), weight: .bold)
        case "SUBTITLE":  return NSFont.systemFont(ofSize: max(12, 22 + delta), weight: .semibold)
        case "HEADING_1": return NSFont.systemFont(ofSize: max(12, 22 + delta), weight: .bold)
        case "HEADING_2": return NSFont.systemFont(ofSize: max(12, 19 + delta), weight: .bold)
        case "HEADING_3": return NSFont.systemFont(ofSize: max(12, 17 + delta), weight: .semibold)
        case "HEADING_4": return NSFont.systemFont(ofSize: max(12, 15 + delta), weight: .semibold)
        case "HEADING_5": return NSFont.systemFont(ofSize: max(12, 14 + delta), weight: .semibold)
        case "HEADING_6": return NSFont.systemFont(ofSize: max(12, 13 + delta), weight: .semibold)
        default:          return NSFont.systemFont(ofSize: CGFloat(max(10, baseSize)))
        }
    }

    private static func font(
        family: String?,
        size: Double?,
        weight: Int?,
        bold: Bool,
        italic: Bool,
        fallback: NSFont
    ) -> NSFont {
        let pointSize = size.map { CGFloat($0) } ?? fallback.pointSize
        let fontManager = NSFontManager.shared
        var traits: NSFontTraitMask = []
        if bold {
            traits.insert(.boldFontMask)
        }
        if italic {
            traits.insert(.italicFontMask)
        }

        if let family, !family.isEmpty,
           let familyFont = fontManager.font(
               withFamily: family,
               traits: traits,
               weight: appKitWeight(forGoogleWeight: weight, bold: bold),
               size: pointSize
           )
        {
            return familyFont
        }

        var resolved = NSFont.systemFont(
            ofSize: pointSize,
            weight: systemWeight(forGoogleWeight: weight, bold: bold)
        )
        if italic {
            resolved = fontManager.convert(resolved, toHaveTrait: .italicFontMask)
        }
        return resolved
    }

    private static func appKitWeight(forGoogleWeight weight: Int?, bold: Bool) -> Int {
        guard let weight else { return bold ? 9 : 5 }
        let mapped: Int
        switch weight {
        case ..<250: mapped = 2
        case ..<350: mapped = 3
        case ..<450: mapped = 5
        case ..<550: mapped = 6
        case ..<650: mapped = 8
        case ..<750: mapped = 9
        case ..<850: mapped = 10
        default: mapped = 12
        }
        return bold ? max(mapped, 9) : mapped
    }

    private static func systemWeight(forGoogleWeight weight: Int?, bold: Bool) -> NSFont.Weight {
        guard let weight else { return bold ? .bold : .regular }
        if bold && weight < 600 {
            return .bold
        }
        switch weight {
        case ..<250: return .ultraLight
        case ..<350: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<650: return .semibold
        case ..<750: return .bold
        case ..<850: return .heavy
        default: return .black
        }
    }

    private static func paragraphSpacing(for namedStyle: String) -> CGFloat {
        switch namedStyle {
        case "TITLE", "HEADING_1", "HEADING_2": return 12
        case "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6": return 8
        default: return 4
        }
    }

    private static func textAlignment(for alignment: String?) -> NSTextAlignment {
        switch alignment {
        case "CENTER": return .center
        case "END": return .right
        case "JUSTIFIED": return .justified
        default: return .left
        }
    }

    private static func applyIndents(
        from paragraph: RichDocumentModel.Paragraph,
        to paragraphStyle: NSMutableParagraphStyle
    ) {
        let baseIndent = CGFloat(paragraph.indentStart ?? 0)
        let nestingIndent = CGFloat(max(0, paragraph.listNestingLevel)) * 18
        let headIndent = max(0, baseIndent + nestingIndent)
        paragraphStyle.headIndent = headIndent
        paragraphStyle.firstLineHeadIndent = max(
            0,
            headIndent + CGFloat(paragraph.indentFirstLine ?? 0)
        )
        if let indentEnd = paragraph.indentEnd {
            paragraphStyle.tailIndent = -CGFloat(indentEnd)
        }
    }

    private static func applyInlinePlaceholderStyle(
        kind: String,
        attributes: inout [NSAttributedString.Key: Any]
    ) {
        attributes[.foregroundColor] = NSColor.secondaryLabelColor
        attributes[.backgroundColor] = NSColor.controlBackgroundColor
        attributes[.underlineStyle] = 0
        if kind == "linkChip" {
            attributes[.foregroundColor] = NSColor.linkColor
        }
    }
}

private extension NSColor {
    static func richRGB(_ color: RichDocumentModel.RGBColor) -> NSColor {
        NSColor(
            calibratedRed: CGFloat(color.red),
            green: CGFloat(color.green),
            blue: CGFloat(color.blue),
            alpha: 1
        )
    }
}

private enum InlineImageAttachment {
    static func attributedString(
        objectId: String,
        contentUri: String?,
        altText: String?,
        attributes: [NSAttributedString.Key: Any]
    ) -> NSAttributedString {
        let attachment = NSTextAttachment()
        let image = image(for: contentUri, altText: altText)
        attachment.attachmentCell = NSTextAttachmentCell(imageCell: scaled(image))
        let result = NSMutableAttributedString(attachment: attachment)
        result.addAttributes(attributes, range: NSRange(location: 0, length: result.length))
        result.addAttribute(.melonPanInlineObjectId, value: objectId, range: NSRange(location: 0, length: result.length))
        return result
    }

    private static func image(for contentUri: String?, altText: String?) -> NSImage {
        if let contentUri,
           let url = URL(string: contentUri),
           let image = NSImage(contentsOf: url) {
            return image
        }
        if let symbol = NSImage(
            systemSymbolName: "photo",
            accessibilityDescription: altText ?? "Inline image"
        ) {
            return symbol
        }
        return NSImage(size: NSSize(width: 48, height: 36))
    }

    private static func scaled(_ image: NSImage) -> NSImage {
        let maxSize = NSSize(width: 240, height: 160)
        guard image.size.width > maxSize.width || image.size.height > maxSize.height else {
            return image
        }
        let widthRatio = maxSize.width / max(image.size.width, 1)
        let heightRatio = maxSize.height / max(image.size.height, 1)
        let scale = min(widthRatio, heightRatio)
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        let scaled = NSImage(size: size)
        scaled.lockFocus()
        image.draw(in: NSRect(origin: .zero, size: size))
        scaled.unlockFocus()
        return scaled
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
