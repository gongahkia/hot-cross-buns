import Foundation
import SwiftUI

enum HCBTextMarkup {
    static func markdownSource(from raw: String) -> String {
        guard containsHTMLMarkup(raw) else { return raw }
        let converted = MarkdownHTML.calendarHTMLToMarkdown(raw)
        return stripRemainingHTML(from: converted)
    }

    private static func containsHTMLMarkup(_ value: String) -> Bool {
        value.range(
            of: #"(?i)(&lt;|<)/?[a-z][a-z0-9-]*(\s[^>]*)?(&gt;|>)"#,
            options: .regularExpression
        ) != nil
    }

    private static func stripRemainingHTML(from value: String) -> String {
        let withoutTags = replacingMatches(
            in: value,
            pattern: #"(?i)</?[a-z][a-z0-9-]*(\s[^>]*)?>"#,
            with: ""
        )
        return withoutTags
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&amp;", with: "&")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func replacingMatches(in value: String, pattern: String, with replacement: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return regex.stringByReplacingMatches(in: value, range: range, withTemplate: replacement)
    }
}

extension Text {
    static func markdown(_ string: String) -> Text {
        let string = HCBTextMarkup.markdownSource(from: string)
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        if let attributed = try? AttributedString(markdown: string, options: options) {
            return Text(attributed)
        }
        return Text(string)
    }
}

// Block-aware markdown renderer. Handles bullet lists (- / *), numbered
// lists (N.), and paragraphs. Inline styling (bold/italic/links/code) still
// flows through Text.markdown per line. Blank lines preserve paragraph gaps.
// §7.01 Phase A2 — view mode only, edit mode stays plain-text source.
struct MarkdownBlock: View {
    let source: String
    var lineSpacing: CGFloat = 2

    var body: some View {
        VStack(alignment: .leading, spacing: lineSpacing) {
            ForEach(Array(parse().enumerated()), id: \.offset) { _, block in
                block
            }
        }
    }

    private func parse() -> [AnyView] {
        let lines = HCBTextMarkup.markdownSource(from: source).components(separatedBy: "\n")
        var out: [AnyView] = []
        for raw in lines {
            let line = raw
            if let prefix = bulletPrefix(line) {
                let body = String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
                out.append(AnyView(
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("•").foregroundStyle(.secondary)
                        Text.markdown(body)
                    }
                ))
            } else if let (marker, rest) = numberedPrefix(line) {
                out.append(AnyView(
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(marker).foregroundStyle(.secondary).monospacedDigit()
                        Text.markdown(rest)
                    }
                ))
            } else if line.trimmingCharacters(in: .whitespaces).isEmpty {
                out.append(AnyView(Text(" ").hidden()))
            } else {
                out.append(AnyView(Text.markdown(line)))
            }
        }
        return out
    }

    private func bulletPrefix(_ line: String) -> String? {
        let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
        if trimmed.hasPrefix("- ") { return String(line.prefix(line.count - trimmed.count)) + "- " }
        if trimmed.hasPrefix("* ") { return String(line.prefix(line.count - trimmed.count)) + "* " }
        return nil
    }

    private func numberedPrefix(_ line: String) -> (String, String)? {
        let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
        var digits = ""
        var rest = Substring(trimmed)
        while let c = rest.first, c.isNumber {
            digits.append(c)
            rest = rest.dropFirst()
        }
        guard digits.isEmpty == false else { return nil }
        guard rest.hasPrefix(". ") else { return nil }
        return ("\(digits).", String(rest.dropFirst(2)))
    }
}
