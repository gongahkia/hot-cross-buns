import AppKit
import Foundation

/// Swift-side projection of `RichDocument`, populated from the FFI's
/// `melon_pan_load_rich_document_for_swift`. Same wire shape as
/// `serialize_rich_document_for_swift` in `crates/melon-pan-core/src/
/// rich_serde.rs`.
///
/// Editor capture path: `RichTextEditorView` reads `paragraphs[].id` and
/// stamps each paragraph's text with the `.melonPanParagraphId` custom
/// attribute. On `textDidChange`, the delegate looks up the attribute at
/// the affected NSRange to recover the paragraph id, computes the
/// UTF-16 offset within that paragraph, and emits a `RichOperation`
/// envelope through `RuntimeBridge.appendOperationEnvelope`.
struct RichDocumentModel: Decodable {
    static let expectedSchemaVersion = 1

    struct Tab: Decodable {
        let tabId: String
        let title: String
        let blocks: [Block]?
        let tables: [Table]?
        let paragraphs: [Paragraph]
        let headers: [Segment]?
        let footers: [Segment]?
        let footnotes: [Segment]?
        let childTabs: [Tab]
    }

    struct Segment: Decodable {
        let segmentId: String
        let kind: String
        let blocks: [Block]
    }

    struct Block: Decodable {
        let kind: String
        let paragraph: Paragraph?
        let table: Table?
    }

    struct Paragraph: Decodable {
        let id: NodeId
        let sourceStartIndex: Int?
        let namedStyle: String
        let alignment: String?
        let indentStart: Double?
        let indentEnd: Double?
        let indentFirstLine: Double?
        let lineSpacing: Double?
        let spaceAbove: Double?
        let spaceBelow: Double?
        let inList: Bool
        let listNestingLevel: Int
        let protected: Bool
        let runs: [Run]
    }

    struct Table: Decodable {
        let id: NodeId
        let startIndex: Int
        let columns: Int
        let rows: [TableRow]
    }

    struct TableRow: Decodable {
        let id: NodeId
        let cells: [TableCell]
    }

    struct TableCell: Decodable {
        let id: NodeId
        let rowSpan: Int
        let columnSpan: Int
        let backgroundColor: RGBColor?
        let borderWidthPt: Double?
        let borderColor: RGBColor?
        let borderDashStyle: String?
        let contentAlignment: String?
        let paddingPt: Double?
        let blocks: [Block]
    }

    struct Run: Decodable {
        let text: String
        let bold: Bool
        let italic: Bool
        let underline: Bool
        let strikethrough: Bool
        let fontFamily: String?
        let fontSizePt: Double?
        let fontWeight: Int?
        let foregroundColor: RGBColor?
        let backgroundColor: RGBColor?
        let linkUrl: String?
        let inlineKind: String?
        let inlineObjectRef: InlineObjectRef?
    }

    struct InlineObjectRef: Decodable {
        let objectId: String
    }

    struct InlineObject: Decodable {
        let objectId: String
        let kind: String
        let altTitle: String
        let altDescription: String
        let contentUri: String?
    }

    struct RGBColor: Decodable, Hashable, Equatable {
        let red: Double
        let green: Double
        let blue: Double
    }

    struct NodeId: Decodable, Hashable, Equatable {
        let kind: String
        let value: String
    }

    let documentId: String
    let schemaVersion: Int
    let title: String
    let revisionId: String
    let inlineObjects: [InlineObject]
    let tabs: [Tab]
}

extension NSAttributedString.Key {
    /// Stable RichNodeId for the paragraph the character belongs to.
    /// Stored as `String` (kind|value packed) so it survives copy/paste
    /// and is cheap to read at edit-time.
    static let melonPanParagraphId = NSAttributedString.Key("melonPanParagraphId")

    /// `Int` UTF-16 offset of the paragraph's first character within the
    /// document-wide attributed string. Computed at render time so the
    /// edit-capture delegate can derive a paragraph-local offset by
    /// subtraction without re-walking the storage.
    static let melonPanParagraphStart = NSAttributedString.Key("melonPanParagraphStart")

    /// `Bool` indicating the paragraph is part of a list at render
    /// time. Used by Cmd-Shift-7 / Cmd-Shift-8 to decide between
    /// CreateList and DeleteList.
    static let melonPanParagraphInList = NSAttributedString.Key("melonPanParagraphInList")

    /// Current list nesting level for the paragraph. Tab / Shift-Tab use
    /// this to emit UpdateListNesting without re-parsing the rich model.
    static let melonPanListNestingLevel = NSAttributedString.Key("melonPanListNestingLevel")

    /// Current Google Docs named style for the paragraph. Used by the
    /// toolbar style menu for undo and state restoration.
    static let melonPanNamedStyle = NSAttributedString.Key("melonPanNamedStyle")

    /// Stable RichNodeId for the containing table when the character is
    /// inside a rendered table cell.
    static let melonPanTableId = NSAttributedString.Key("melonPanTableId")

    /// Zero-based rendered table row index for table-cell content.
    static let melonPanTableRowIndex = NSAttributedString.Key("melonPanTableRowIndex")

    /// Zero-based rendered table column index for table-cell content.
    static let melonPanTableColumnIndex = NSAttributedString.Key("melonPanTableColumnIndex")

    /// Rendered row span for the table cell under the caret.
    static let melonPanTableRowSpan = NSAttributedString.Key("melonPanTableRowSpan")

    /// Rendered column span for the table cell under the caret.
    static let melonPanTableColumnSpan = NSAttributedString.Key("melonPanTableColumnSpan")

    /// Docs inline object id for rendered image attachments.
    static let melonPanInlineObjectId = NSAttributedString.Key("melonPanInlineObjectId")

    /// Rendered editor chrome or preserved non-body segment content. The
    /// editor blocks direct text edits through these ranges because they
    /// are labels/separators rather than document content.
    static let melonPanProtectedRenderRange = NSAttributedString.Key("melonPanProtectedRenderRange")

    /// Google Docs segment id for header/footer/footnote paragraphs. Empty
    /// or absent means the body segment.
    static let melonPanSegmentId = NSAttributedString.Key("melonPanSegmentId")

    /// User-visible segment kind (`header`, `footer`, `footnote`, or
    /// `body`) for UI and diagnostics.
    static let melonPanSegmentKind = NSAttributedString.Key("melonPanSegmentKind")
}

extension RichDocumentModel.NodeId {
    /// Pack as `kind|value`. Inverse of the parse done in
    /// `RichOperationEnvelopeBuilder`.
    var packed: String { "\(kind)|\(value)" }

    static func unpack(_ packed: String) -> RichDocumentModel.NodeId? {
        guard let separator = packed.firstIndex(of: "|") else { return nil }
        let kind = String(packed[..<separator])
        let value = String(packed[packed.index(after: separator)...])
        return RichDocumentModel.NodeId(kind: kind, value: value)
    }
}
