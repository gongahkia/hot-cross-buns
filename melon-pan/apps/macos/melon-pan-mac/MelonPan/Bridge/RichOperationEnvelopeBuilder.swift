import Foundation

/// Builds the JSON envelope expected by `melon_pan_append_operation_envelope`.
/// Wire format mirrors `rich_oplog::serialize_envelope` in
/// `crates/melon-pan-core/src/rich_oplog.rs`. Keep in sync.
enum RichOperationEnvelopeBuilder {
    enum Op {
        case insertText(paragraphId: RichDocumentModel.NodeId, utf16Offset: Int, text: String)
        case deleteRange(paragraphId: RichDocumentModel.NodeId, utf16Start: Int, utf16End: Int)
        case replaceRange(
            paragraphId: RichDocumentModel.NodeId,
            utf16Start: Int,
            utf16End: Int,
            text: String
        )
        case setTextStyle(
            paragraphId: RichDocumentModel.NodeId,
            utf16Start: Int,
            utf16End: Int,
            delta: StyleDelta
        )
        case clearTextStyle(
            paragraphId: RichDocumentModel.NodeId,
            utf16Start: Int,
            utf16End: Int
        )
        case setParagraphNamedStyle(paragraphId: RichDocumentModel.NodeId, namedStyle: String)
        case setParagraphStyle(paragraphId: RichDocumentModel.NodeId, delta: ParagraphStyleDelta)
        case setNamedStyle(namedStyle: String, delta: NamedStyleDelta)
        case createLink(
            paragraphId: RichDocumentModel.NodeId,
            utf16Start: Int,
            utf16End: Int,
            url: String
        )
        case createList(paragraphId: RichDocumentModel.NodeId, ordered: Bool)
        case updateListNesting(paragraphId: RichDocumentModel.NodeId, nestingLevel: Int)
        case deleteList(paragraphId: RichDocumentModel.NodeId)
        case insertTable(paragraphId: RichDocumentModel.NodeId, rows: Int, columns: Int)
        case deleteTable(tableId: RichDocumentModel.NodeId)
        case insertTableRow(tableId: RichDocumentModel.NodeId, rowIndex: Int, insertBelow: Bool)
        case deleteTableRow(tableId: RichDocumentModel.NodeId, rowIndex: Int)
        case insertTableColumn(tableId: RichDocumentModel.NodeId, columnIndex: Int, insertRight: Bool)
        case deleteTableColumn(tableId: RichDocumentModel.NodeId, columnIndex: Int)
        case cancelOperation(operationId: String)
        case setTableCellStyle(
            tableId: RichDocumentModel.NodeId,
            rowIndex: Int,
            columnIndex: Int,
            rowSpan: Int,
            columnSpan: Int,
            delta: TableCellStyleDelta
        )
        case setTableColumnWidth(tableId: RichDocumentModel.NodeId, columnIndex: Int, widthPt: Double)
        case setTableRowMinHeight(tableId: RichDocumentModel.NodeId, rowIndex: Int, minHeightPt: Double)
        case mergeTableCells(
            tableId: RichDocumentModel.NodeId,
            rowIndex: Int,
            columnIndex: Int,
            rowSpan: Int,
            columnSpan: Int
        )
        case unmergeTableCells(
            tableId: RichDocumentModel.NodeId,
            rowIndex: Int,
            columnIndex: Int,
            rowSpan: Int,
            columnSpan: Int
        )
        case insertInlineImage(
            paragraphId: RichDocumentModel.NodeId,
            utf16Offset: Int,
            uri: String
        )
        case deleteInlineObject(objectId: String)
        case createHeader
        case deleteHeader(headerId: String)
        case createFooter
        case deleteFooter(footerId: String)
        case createFootnote(paragraphId: RichDocumentModel.NodeId, utf16Offset: Int)
        case deleteFootnote(footnoteId: String)
    }

    /// Mirrors `RichStyleDelta` in `crates/melon-pan-core/src/rich_ops.rs`.
    /// Each `Optional` represents "is this delta touching the field?"; a
    /// nil leaves the existing style unchanged. For `linkUrl` an inner
    /// nil clears the link.
    struct StyleDelta {
        var bold: Bool? = nil
        var italic: Bool? = nil
        var underline: Bool? = nil
        var strikethrough: Bool? = nil
        var fontFamily: String?? = nil
        var fontSizePt: Double?? = nil
        var foregroundColor: RGBColor?? = nil
        var backgroundColor: RGBColor?? = nil
        var linkUrl: String?? = nil
    }

    /// Mirrors `RichParagraphStyleDelta` in `crates/melon-pan-core/src/rich_ops.rs`.
    struct ParagraphStyleDelta {
        var alignment: String? = nil
        var indentStart: Double? = nil
        var indentEnd: Double? = nil
        var indentFirstLine: Double? = nil
        var lineSpacing: Double? = nil
        var spaceAbove: Double? = nil
        var spaceBelow: Double? = nil
    }

    /// Mirrors `RichNamedStyleDelta` in `crates/melon-pan-core/src/rich_ops.rs`.
    struct NamedStyleDelta {
        var textStyle = StyleDelta()
        var paragraphStyle = ParagraphStyleDelta()
    }

    struct RGBColor {
        var red: Double
        var green: Double
        var blue: Double
    }

    /// Mirrors `RichTableCellStyleDelta` in `crates/melon-pan-core/src/rich_ops.rs`.
    struct TableCellStyleDelta {
        var backgroundColor: RGBColor?? = nil
        var borderWidthPt: Double?? = nil
        var borderColor: RGBColor?? = nil
        var borderDashStyle: String?? = nil
        var borderTopWidthPt: Double?? = nil
        var borderRightWidthPt: Double?? = nil
        var borderBottomWidthPt: Double?? = nil
        var borderLeftWidthPt: Double?? = nil
        var paddingPt: Double?? = nil
        var contentAlignment: String?? = nil
    }

    /// Serialize an envelope ready to hand to the FFI. `actor` is the
    /// active Google account email; the runtime stamps it onto sync-
    /// journal entries for audit. `tabId` is the tab the edit happened
    /// in; empty string means "default tab".
    static func serialize(
        operationId: String,
        documentId: String,
        tabId: String,
        baseRevisionId: String,
        actor: String,
        op: Op,
        timestampISO8601: String = ISO8601DateFormatter().string(from: Date())
    ) -> String {
        let opJson = serializeOp(op)
        return """
        {"operationId":"\(escape(operationId))",\
        "documentId":"\(escape(documentId))",\
        "tabId":"\(escape(tabId))",\
        "baseRevisionId":"\(escape(baseRevisionId))",\
        "localTimestamp":"\(escape(timestampISO8601))",\
        "actor":"\(escape(actor))",\
        "op":\(opJson)}
        """
    }

    private static func serializeOp(_ op: Op) -> String {
        switch op {
        case let .insertText(paragraphId, utf16Offset, text):
            return """
            {"kind":"InsertText","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Offset":\(utf16Offset),\
            "text":"\(escape(text))"}
            """
        case let .deleteRange(paragraphId, utf16Start, utf16End):
            return """
            {"kind":"DeleteRange","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Start":\(utf16Start),"utf16End":\(utf16End)}
            """
        case let .replaceRange(paragraphId, utf16Start, utf16End, text):
            return """
            {"kind":"ReplaceRange","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Start":\(utf16Start),"utf16End":\(utf16End),\
            "text":"\(escape(text))"}
            """
        case let .setTextStyle(paragraphId, utf16Start, utf16End, delta):
            return """
            {"kind":"SetTextStyle","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Start":\(utf16Start),"utf16End":\(utf16End),\
            "delta":\(serializeDelta(delta))}
            """
        case let .clearTextStyle(paragraphId, utf16Start, utf16End):
            return """
            {"kind":"ClearTextStyle","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Start":\(utf16Start),"utf16End":\(utf16End)}
            """
        case let .setParagraphNamedStyle(paragraphId, namedStyle):
            return """
            {"kind":"SetParagraphNamedStyle","paragraphId":\(serializeNodeId(paragraphId)),\
            "namedStyle":"\(escape(namedStyle))"}
            """
        case let .setParagraphStyle(paragraphId, delta):
            return """
            {"kind":"SetParagraphStyle","paragraphId":\(serializeNodeId(paragraphId)),\
            "delta":\(serializeParagraphDelta(delta))}
            """
        case let .setNamedStyle(namedStyle, delta):
            return """
            {"kind":"SetNamedStyle","namedStyle":"\(escape(namedStyle))",\
            "delta":\(serializeNamedStyleDelta(delta))}
            """
        case let .createLink(paragraphId, utf16Start, utf16End, url):
            return """
            {"kind":"CreateLink","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Start":\(utf16Start),"utf16End":\(utf16End),\
            "url":"\(escape(url))"}
            """
        case let .createList(paragraphId, ordered):
            return """
            {"kind":"CreateList","paragraphId":\(serializeNodeId(paragraphId)),\
            "ordered":\(ordered)}
            """
        case let .updateListNesting(paragraphId, nestingLevel):
            return """
            {"kind":"UpdateListNesting","paragraphId":\(serializeNodeId(paragraphId)),\
            "nestingLevel":\(max(0, nestingLevel))}
            """
        case let .deleteList(paragraphId):
            return """
            {"kind":"DeleteList","paragraphId":\(serializeNodeId(paragraphId))}
            """
        case let .insertTable(paragraphId, rows, columns):
            return """
            {"kind":"InsertTable","paragraphId":\(serializeNodeId(paragraphId)),\
            "rows":\(max(0, rows)),"columns":\(max(0, columns))}
            """
        case let .deleteTable(tableId):
            return """
            {"kind":"DeleteTable","tableId":\(serializeNodeId(tableId))}
            """
        case let .insertTableRow(tableId, rowIndex, insertBelow):
            return """
            {"kind":"InsertTableRow","tableId":\(serializeNodeId(tableId)),\
            "rowIndex":\(max(0, rowIndex)),"insertBelow":\(insertBelow)}
            """
        case let .deleteTableRow(tableId, rowIndex):
            return """
            {"kind":"DeleteTableRow","tableId":\(serializeNodeId(tableId)),\
            "rowIndex":\(max(0, rowIndex))}
            """
        case let .insertTableColumn(tableId, columnIndex, insertRight):
            return """
            {"kind":"InsertTableColumn","tableId":\(serializeNodeId(tableId)),\
            "columnIndex":\(max(0, columnIndex)),"insertRight":\(insertRight)}
            """
        case let .deleteTableColumn(tableId, columnIndex):
            return """
            {"kind":"DeleteTableColumn","tableId":\(serializeNodeId(tableId)),\
            "columnIndex":\(max(0, columnIndex))}
            """
        case let .cancelOperation(operationId):
            return """
            {"kind":"CancelOperation","operationId":"\(escape(operationId))"}
            """
        case let .setTableCellStyle(tableId, rowIndex, columnIndex, rowSpan, columnSpan, delta):
            return """
            {"kind":"SetTableCellStyle","tableId":\(serializeNodeId(tableId)),\
            "rowIndex":\(max(0, rowIndex)),"columnIndex":\(max(0, columnIndex)),\
            "rowSpan":\(max(1, rowSpan)),"columnSpan":\(max(1, columnSpan)),\
            "delta":\(serializeTableCellDelta(delta))}
            """
        case let .setTableColumnWidth(tableId, columnIndex, widthPt):
            return """
            {"kind":"SetTableColumnWidth","tableId":\(serializeNodeId(tableId)),\
            "columnIndex":\(max(0, columnIndex)),"widthPt":\(max(24.0, widthPt))}
            """
        case let .setTableRowMinHeight(tableId, rowIndex, minHeightPt):
            return """
            {"kind":"SetTableRowMinHeight","tableId":\(serializeNodeId(tableId)),\
            "rowIndex":\(max(0, rowIndex)),"minHeightPt":\(max(16.0, minHeightPt))}
            """
        case let .mergeTableCells(tableId, rowIndex, columnIndex, rowSpan, columnSpan):
            return """
            {"kind":"MergeTableCells","tableId":\(serializeNodeId(tableId)),\
            "rowIndex":\(max(0, rowIndex)),"columnIndex":\(max(0, columnIndex)),\
            "rowSpan":\(max(1, rowSpan)),"columnSpan":\(max(1, columnSpan))}
            """
        case let .unmergeTableCells(tableId, rowIndex, columnIndex, rowSpan, columnSpan):
            return """
            {"kind":"UnmergeTableCells","tableId":\(serializeNodeId(tableId)),\
            "rowIndex":\(max(0, rowIndex)),"columnIndex":\(max(0, columnIndex)),\
            "rowSpan":\(max(1, rowSpan)),"columnSpan":\(max(1, columnSpan))}
            """
        case let .insertInlineImage(paragraphId, utf16Offset, uri):
            return """
            {"kind":"InsertInlineImage","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Offset":\(max(0, utf16Offset)),"uri":"\(escape(uri))"}
            """
        case let .deleteInlineObject(objectId):
            return """
            {"kind":"DeleteInlineObject","objectId":"\(escape(objectId))"}
            """
        case .createHeader:
            return #"{"kind":"CreateHeader"}"#
        case let .deleteHeader(headerId):
            return """
            {"kind":"DeleteHeader","headerId":"\(escape(headerId))"}
            """
        case .createFooter:
            return #"{"kind":"CreateFooter"}"#
        case let .deleteFooter(footerId):
            return """
            {"kind":"DeleteFooter","footerId":"\(escape(footerId))"}
            """
        case let .createFootnote(paragraphId, utf16Offset):
            return """
            {"kind":"CreateFootnote","paragraphId":\(serializeNodeId(paragraphId)),\
            "utf16Offset":\(max(0, utf16Offset))}
            """
        case let .deleteFootnote(footnoteId):
            return """
            {"kind":"DeleteFootnote","footnoteId":"\(escape(footnoteId))"}
            """
        }
    }

    private static func serializeDelta(_ delta: StyleDelta) -> String {
        var parts: [String] = []
        if let value = delta.bold {
            parts.append("\"bold\":\(value)")
        }
        if let value = delta.italic {
            parts.append("\"italic\":\(value)")
        }
        if let value = delta.underline {
            parts.append("\"underline\":\(value)")
        }
        if let value = delta.strikethrough {
            parts.append("\"strikethrough\":\(value)")
        }
        if let outer = delta.fontFamily {
            switch outer {
            case .some(let fontFamily):
                parts.append("\"fontFamily\":\"\(escape(fontFamily))\"")
            case .none:
                parts.append("\"fontFamily\":null")
            }
        }
        if let outer = delta.fontSizePt {
            switch outer {
            case .some(let fontSizePt):
                parts.append("\"fontSizePt\":\(fontSizePt)")
            case .none:
                parts.append("\"fontSizePt\":null")
            }
        }
        if let outer = delta.foregroundColor {
            switch outer {
            case .some(let color):
                parts.append("\"foregroundColor\":\(serializeRGBColor(color))")
            case .none:
                parts.append("\"foregroundColor\":null")
            }
        }
        if let outer = delta.backgroundColor {
            switch outer {
            case .some(let color):
                parts.append("\"backgroundColor\":\(serializeRGBColor(color))")
            case .none:
                parts.append("\"backgroundColor\":null")
            }
        }
        if let outer = delta.linkUrl {
            switch outer {
            case .some(let url):
                parts.append("\"linkUrl\":\"\(escape(url))\"")
            case .none:
                parts.append("\"linkUrl\":null")
            }
        }
        return "{\(parts.joined(separator: ","))}"
    }

    private static func serializeRGBColor(_ color: RGBColor) -> String {
        """
        {"red":\(color.red),"green":\(color.green),"blue":\(color.blue)}
        """
    }

    private static func serializeParagraphDelta(_ delta: ParagraphStyleDelta) -> String {
        var parts: [String] = []
        if let value = delta.alignment {
            parts.append("\"alignment\":\"\(escape(value))\"")
        }
        if let value = delta.indentStart {
            parts.append("\"indentStart\":\(value)")
        }
        if let value = delta.indentEnd {
            parts.append("\"indentEnd\":\(value)")
        }
        if let value = delta.indentFirstLine {
            parts.append("\"indentFirstLine\":\(value)")
        }
        if let value = delta.lineSpacing {
            parts.append("\"lineSpacing\":\(value)")
        }
        if let value = delta.spaceAbove {
            parts.append("\"spaceAbove\":\(value)")
        }
        if let value = delta.spaceBelow {
            parts.append("\"spaceBelow\":\(value)")
        }
        return "{\(parts.joined(separator: ","))}"
    }

    private static func serializeNamedStyleDelta(_ delta: NamedStyleDelta) -> String {
        return """
        {"textStyle":\(serializeDelta(delta.textStyle)),\
        "paragraphStyle":\(serializeParagraphDelta(delta.paragraphStyle))}
        """
    }

    private static func serializeTableCellDelta(_ delta: TableCellStyleDelta) -> String {
        var parts: [String] = []
        if let outer = delta.backgroundColor {
            switch outer {
            case .some(let color):
                parts.append("""
                "backgroundColor":{"red":\(color.red),"green":\(color.green),"blue":\(color.blue)}
                """)
            case .none:
                parts.append("\"backgroundColor\":null")
            }
        }
        if let outer = delta.borderWidthPt {
            switch outer {
            case .some(let width):
                parts.append("\"borderWidthPt\":\(width)")
            case .none:
                parts.append("\"borderWidthPt\":null")
            }
        }
        if let outer = delta.borderColor {
            switch outer {
            case .some(let color):
                parts.append("\"borderColor\":\(serializeRGBColor(color))")
            case .none:
                parts.append("\"borderColor\":null")
            }
        }
        if let outer = delta.borderDashStyle {
            switch outer {
            case .some(let style):
                parts.append("\"borderDashStyle\":\"\(escape(style))\"")
            case .none:
                parts.append("\"borderDashStyle\":null")
            }
        }
        appendOptionalDouble(delta.borderTopWidthPt, key: "borderTopWidthPt", to: &parts)
        appendOptionalDouble(delta.borderRightWidthPt, key: "borderRightWidthPt", to: &parts)
        appendOptionalDouble(delta.borderBottomWidthPt, key: "borderBottomWidthPt", to: &parts)
        appendOptionalDouble(delta.borderLeftWidthPt, key: "borderLeftWidthPt", to: &parts)
        if let outer = delta.paddingPt {
            switch outer {
            case .some(let padding):
                parts.append("\"paddingPt\":\(padding)")
            case .none:
                parts.append("\"paddingPt\":null")
            }
        }
        if let outer = delta.contentAlignment {
            switch outer {
            case .some(let alignment):
                parts.append("\"contentAlignment\":\"\(escape(alignment))\"")
            case .none:
                parts.append("\"contentAlignment\":null")
            }
        }
        return "{\(parts.joined(separator: ","))}"
    }

    private static func appendOptionalDouble(_ value: Double??, key: String, to parts: inout [String]) {
        guard let outer = value else { return }
        switch outer {
        case .some(let value):
            parts.append("\"\(key)\":\(value)")
        case .none:
            parts.append("\"\(key)\":null")
        }
    }

    private static func serializeNodeId(_ id: RichDocumentModel.NodeId) -> String {
        return """
        {"kind":"\(escape(id.kind))","value":"\(escape(id.value))"}
        """
    }

    /// JSON-string escape: backslash, quote, control chars (\n, \r, \t,
    /// \b, \f, others as \uXXXX). Matches the Rust `json_escape` in
    /// `crates/melon-pan-core/src/encoding.rs`.
    private static func escape(_ value: String) -> String {
        var out = ""
        out.reserveCapacity(value.count)
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out.append("\\\"")
            case "\\": out.append("\\\\")
            case "\u{08}": out.append("\\b")
            case "\u{0c}": out.append("\\f")
            case "\n": out.append("\\n")
            case "\r": out.append("\\r")
            case "\t": out.append("\\t")
            default:
                if scalar.value < 0x20 {
                    out.append(String(format: "\\u%04x", scalar.value))
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out
    }
}
