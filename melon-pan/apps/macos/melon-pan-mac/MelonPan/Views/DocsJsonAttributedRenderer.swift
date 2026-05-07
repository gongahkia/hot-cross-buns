import AppKit
import Foundation

/// Walks a Google Docs API JSON payload and produces an
/// `NSAttributedString` covering the V1 rendering surface:
/// paragraphs, headings, bold, italic, underline, strikethrough, links.
///
/// This renderer intentionally lives in Swift rather than going through
/// the Rust FFI for V1. Apple's `JSONSerialization` is well-trodden, the
/// renderer is small, and keeping it Swift-side avoids growing the FFI
/// boundary before we know the editor's exact attributed-string needs.
/// When edit capture lands (M3) the renderer is replaced by an FFI-based
/// bridge that returns the canonical `RichDocument` projection.
enum DocsJsonAttributedRenderer {
    /// Read `current.docs.json` from disk and render. Returns nil when
    /// the file is missing (doc not yet pulled), unreadable, or the JSON
    /// is malformed. Cache layout matches `LocalCacheStore::paths_for`:
    /// `<cacheRoot>/docs/<safe_document_id>/current.docs.json`. The id
    /// is sanitized identically to `sanitize_path_segment` in storage.rs:
    /// each non-alphanumeric/non-`-_.` byte becomes `_`.
    static func loadFromCache(cacheRoot: String, documentId: String) -> NSAttributedString? {
        let safeId = sanitizePathSegment(documentId)
        let path = (cacheRoot as NSString)
            .appendingPathComponent("docs")
        let docPath = (path as NSString).appendingPathComponent(safeId)
        let filePath = (docPath as NSString).appendingPathComponent("current.docs.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)) else {
            return nil
        }
        return render(rawDocsJson: data)
    }

    /// Mirror of `sanitize_path_segment` in `melon-pan-core/src/storage.rs`.
    /// Replaces only the OS-unsafe characters with `_`; everything else
    /// passes through unchanged. Keep in sync — divergence silently breaks
    /// cache lookups.
    private static func sanitizePathSegment(_ id: String) -> String {
        let unsafe: Set<Character> = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|"]
        var out = ""
        out.reserveCapacity(id.count)
        for ch in id {
            out.append(unsafe.contains(ch) ? "_" : ch)
        }
        return out
    }

    /// Build an attributed string from raw `current.docs.json` bytes.
    /// Returns `nil` only on outright JSON parse failure; missing fields
    /// fall back to plain text so the editor never shows a blank canvas
    /// because the doc happened to use a Docs feature we don't model yet.
    static func render(rawDocsJson data: Data) -> NSAttributedString? {
        guard let root = try? JSONSerialization.jsonObject(
            with: data,
            options: [.allowFragments]
        ) as? [String: Any] else {
            return nil
        }

        let result = NSMutableAttributedString()

        // Single-tab legacy: body is at root.body.content.
        // Multi-tab: tabs[].documentTab.body.content (V1 renders the
        // first tab; tab switcher is M2 work).
        if let body = root["body"] as? [String: Any],
           let content = body["content"] as? [[String: Any]] {
            renderContent(content, into: result)
        } else if let tabs = root["tabs"] as? [[String: Any]],
                  let firstTab = tabs.first,
                  let documentTab = firstTab["documentTab"] as? [String: Any],
                  let body = documentTab["body"] as? [String: Any],
                  let content = body["content"] as? [[String: Any]] {
            renderContent(content, into: result)
        }

        if result.length == 0 {
            return NSAttributedString(
                string: "(empty document)",
                attributes: [.font: NSFont.systemFont(ofSize: 14)]
            )
        }
        return result
    }

    private static func renderContent(
        _ content: [[String: Any]],
        into result: NSMutableAttributedString
    ) {
        for element in content {
            if let paragraph = element["paragraph"] as? [String: Any] {
                renderParagraph(paragraph, into: result)
            } else if let table = element["table"] as? [String: Any] {
                renderTable(table, into: result)
            } else if element["sectionBreak"] != nil {
                result.append(NSAttributedString(string: "\n"))
            } else if element["tableOfContents"] != nil {
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: NSFont.systemFont(ofSize: 13, weight: .light),
                    .foregroundColor: NSColor.secondaryLabelColor
                ]
                result.append(NSAttributedString(
                    string: "[Table of contents]\n",
                    attributes: attrs
                ))
            }
        }
    }

    private static func renderParagraph(
        _ paragraph: [String: Any],
        into result: NSMutableAttributedString
    ) {
        let style = paragraph["paragraphStyle"] as? [String: Any]
        let namedStyle = style?["namedStyleType"] as? String ?? "NORMAL_TEXT"
        let bullet = paragraph["bullet"] as? [String: Any]

        let paragraphFont = font(forNamedStyle: namedStyle)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.paragraphSpacing = paragraphSpacing(for: namedStyle)

        if bullet != nil {
            let nestingLevel = (bullet?["nestingLevel"] as? Int) ?? 0
            let indent = "    ".repeating(count: nestingLevel)
            let prefix: String = "\(indent)• "
            let prefixAttrs: [NSAttributedString.Key: Any] = [
                .font: paragraphFont,
                .paragraphStyle: paragraphStyle
            ]
            result.append(NSAttributedString(string: prefix, attributes: prefixAttrs))
        }

        let elements = paragraph["elements"] as? [[String: Any]] ?? []
        for element in elements {
            if let textRun = element["textRun"] as? [String: Any] {
                let content = textRun["content"] as? String ?? ""
                let textStyle = textRun["textStyle"] as? [String: Any] ?? [:]
                let attributes = attributes(
                    for: textStyle,
                    baseFont: paragraphFont,
                    paragraphStyle: paragraphStyle
                )
                result.append(NSAttributedString(string: content, attributes: attributes))
            } else if element["inlineObjectElement"] != nil {
                result.append(NSAttributedString(
                    string: "[image]",
                    attributes: [
                        .font: paragraphFont,
                        .foregroundColor: NSColor.secondaryLabelColor,
                        .paragraphStyle: paragraphStyle
                    ]
                ))
            } else if element["pageBreak"] != nil {
                result.append(NSAttributedString(string: "\n\n"))
            } else if element["horizontalRule"] != nil {
                result.append(NSAttributedString(string: "\u{2014}\u{2014}\u{2014}\n"))
            } else if let footnote = element["footnoteReference"] as? [String: Any] {
                let id = footnote["footnoteId"] as? String ?? ""
                result.append(NSAttributedString(
                    string: "[^\(id)]",
                    attributes: [
                        .font: paragraphFont,
                        .foregroundColor: NSColor.secondaryLabelColor,
                        .paragraphStyle: paragraphStyle
                    ]
                ))
            } else if element["equation"] != nil {
                result.append(NSAttributedString(
                    string: "[equation]",
                    attributes: [
                        .font: paragraphFont,
                        .foregroundColor: NSColor.secondaryLabelColor,
                        .paragraphStyle: paragraphStyle
                    ]
                ))
            }
        }
        // Paragraphs don't always end with a textRun newline; ensure one
        // so headings and adjacent paragraphs render on separate lines.
        if !result.string.hasSuffix("\n") {
            result.append(NSAttributedString(string: "\n"))
        }
    }

    private static func renderTable(
        _ table: [String: Any],
        into result: NSMutableAttributedString
    ) {
        let rows = table["tableRows"] as? [[String: Any]] ?? []
        for row in rows {
            let cells = row["tableCells"] as? [[String: Any]] ?? []
            var rowText = ""
            for (index, cell) in cells.enumerated() {
                let cellContent = cell["content"] as? [[String: Any]] ?? []
                let cellAttr = NSMutableAttributedString()
                renderContent(cellContent, into: cellAttr)
                let cellPlain = cellAttr.string
                    .replacingOccurrences(of: "\n", with: " ")
                    .trimmingCharacters(in: .whitespaces)
                rowText.append(cellPlain)
                if index < cells.count - 1 {
                    rowText.append(" | ")
                }
            }
            rowText.append("\n")
            result.append(NSAttributedString(
                string: rowText,
                attributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
                ]
            ))
        }
    }

    private static func font(forNamedStyle namedStyle: String) -> NSFont {
        switch namedStyle {
        case "TITLE":
            return NSFont.systemFont(ofSize: 28, weight: .bold)
        case "SUBTITLE":
            return NSFont.systemFont(ofSize: 22, weight: .semibold)
        case "HEADING_1":
            return NSFont.systemFont(ofSize: 22, weight: .bold)
        case "HEADING_2":
            return NSFont.systemFont(ofSize: 19, weight: .bold)
        case "HEADING_3":
            return NSFont.systemFont(ofSize: 17, weight: .semibold)
        case "HEADING_4":
            return NSFont.systemFont(ofSize: 15, weight: .semibold)
        case "HEADING_5":
            return NSFont.systemFont(ofSize: 14, weight: .semibold)
        case "HEADING_6":
            return NSFont.systemFont(ofSize: 13, weight: .semibold)
        default:
            return NSFont.systemFont(ofSize: 14)
        }
    }

    private static func paragraphSpacing(for namedStyle: String) -> CGFloat {
        switch namedStyle {
        case "TITLE", "HEADING_1", "HEADING_2":
            return 12
        case "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6":
            return 8
        default:
            return 4
        }
    }

    private static func attributes(
        for textStyle: [String: Any],
        baseFont: NSFont,
        paragraphStyle: NSParagraphStyle
    ) -> [NSAttributedString.Key: Any] {
        var attrs: [NSAttributedString.Key: Any] = [
            .paragraphStyle: paragraphStyle
        ]

        var symbolicTraits: NSFontDescriptor.SymbolicTraits = []
        if (textStyle["bold"] as? Bool) == true {
            symbolicTraits.insert(.bold)
        }
        if (textStyle["italic"] as? Bool) == true {
            symbolicTraits.insert(.italic)
        }
        let descriptor = baseFont.fontDescriptor.withSymbolicTraits(symbolicTraits)
        let resolvedFont = NSFont(descriptor: descriptor, size: baseFont.pointSize) ?? baseFont
        attrs[.font] = resolvedFont

        if (textStyle["underline"] as? Bool) == true {
            attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
        }
        if (textStyle["strikethrough"] as? Bool) == true {
            attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
        }
        if let link = textStyle["link"] as? [String: Any],
           let url = link["url"] as? String,
           !url.isEmpty,
           let nsUrl = URL(string: url) {
            attrs[.link] = nsUrl
            attrs[.foregroundColor] = NSColor.linkColor
        }

        return attrs
    }
}

private extension String {
    func repeating(count: Int) -> String {
        guard count > 0 else { return "" }
        return String(repeating: self, count: count)
    }
}
