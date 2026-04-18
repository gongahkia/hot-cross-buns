import Foundation

// Google Calendar event description accepts a limited HTML subset
// (a, b, i, u, br, ul, ol, li). This file converts between markdown
// and that subset so our editor can stay markdown-first while the
// Calendar web UI keeps rendering rich text.
//
// Unknown HTML encountered on read is preserved as-is in the markdown
// body so that formatting authored elsewhere is not destroyed on the
// next write.
enum MarkdownHTML {
    static func markdownToCalendarHTML(_ markdown: String) -> String {
        guard markdown.isEmpty == false else { return "" }
        var lines = markdown.components(separatedBy: "\n")
        lines = groupListsInLines(lines)
        let paragraphs = lines.joined(separator: "<br>")
        return applyInline(paragraphs)
    }

    static func calendarHTMLToMarkdown(_ html: String) -> String {
        guard html.isEmpty == false else { return "" }
        var working = html
        working = working.replacingOccurrences(of: "\r\n", with: "\n")
        working = decodeBasicEntities(working)
        working = replaceLists(in: working)
        working = replaceBreaks(in: working)
        working = replaceInline(in: working)
        return working.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: markdown → HTML

    private static func groupListsInLines(_ lines: [String]) -> [String] {
        var result: [String] = []
        var buffer: [String] = []
        var currentKind: ListKind?

        func flush() {
            guard let kind = currentKind else {
                result.append(contentsOf: buffer)
                buffer.removeAll()
                return
            }
            let items = buffer.map { "<li>\(applyInline($0))</li>" }.joined()
            let tag = kind == .unordered ? "ul" : "ol"
            result.append("<\(tag)>\(items)</\(tag)>")
            buffer.removeAll()
            currentKind = nil
        }

        for line in lines {
            if let stripped = stripListMarker(line, kind: .unordered) {
                if currentKind != .unordered { flush() }
                currentKind = .unordered
                buffer.append(stripped)
            } else if let stripped = stripListMarker(line, kind: .ordered) {
                if currentKind != .ordered { flush() }
                currentKind = .ordered
                buffer.append(stripped)
            } else {
                flush()
                result.append(line)
            }
        }
        flush()
        return result
    }

    private static func stripListMarker(_ line: String, kind: ListKind) -> String? {
        let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
        switch kind {
        case .unordered:
            if trimmed.hasPrefix("- ") { return String(trimmed.dropFirst(2)) }
            if trimmed.hasPrefix("* ") { return String(trimmed.dropFirst(2)) }
            return nil
        case .ordered:
            var iter = trimmed.makeIterator()
            var digits = ""
            while let ch = iter.next(), ch.isNumber {
                digits.append(ch)
            }
            guard digits.isEmpty == false else { return nil }
            let afterDigits = trimmed.dropFirst(digits.count)
            guard afterDigits.hasPrefix(". ") else { return nil }
            return String(afterDigits.dropFirst(2))
        }
    }

    private enum ListKind { case unordered, ordered }

    private static func applyInline(_ text: String) -> String {
        var value = text
        // Links: [text](url)
        value = value.replacingMatches(of: #"\[([^\]]+)\]\(([^)]+)\)"#) { groups in
            guard groups.count == 3 else { return nil }
            return "<a href=\"\(escapeAttr(groups[2]))\">\(groups[1])</a>"
        }
        // Bold: **text**
        value = value.replacingMatches(of: #"\*\*([^\*]+)\*\*"#) { groups in
            guard groups.count == 2 else { return nil }
            return "<b>\(groups[1])</b>"
        }
        // Underline: __text__ (two underscores before italic single)
        value = value.replacingMatches(of: #"__([^_]+)__"#) { groups in
            guard groups.count == 2 else { return nil }
            return "<u>\(groups[1])</u>"
        }
        // Italic: *text*
        value = value.replacingMatches(of: #"\*([^\*\n]+)\*"#) { groups in
            guard groups.count == 2 else { return nil }
            return "<i>\(groups[1])</i>"
        }
        return value
    }

    private static func escapeAttr(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    // MARK: HTML → markdown

    private static func decodeBasicEntities(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
    }

    private static func replaceBreaks(in value: String) -> String {
        value.replacingMatches(of: #"<br\s*/?>"#) { _ in "\n" }
    }

    private static func replaceInline(in value: String) -> String {
        var working = value
        working = working.replacingMatches(of: #"<a[^>]*href=\"([^\"]*)\"[^>]*>(.*?)</a>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 3 else { return nil }
            return "[\(groups[2])](\(groups[1]))"
        }
        working = working.replacingMatches(of: #"<b>(.*?)</b>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return "**\(groups[1])**"
        }
        working = working.replacingMatches(of: #"<strong>(.*?)</strong>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return "**\(groups[1])**"
        }
        working = working.replacingMatches(of: #"<u>(.*?)</u>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return "__\(groups[1])__"
        }
        working = working.replacingMatches(of: #"<i>(.*?)</i>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return "*\(groups[1])*"
        }
        working = working.replacingMatches(of: #"<em>(.*?)</em>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return "*\(groups[1])*"
        }
        return working
    }

    private static func replaceLists(in value: String) -> String {
        var working = value
        working = working.replacingMatches(of: #"<ul[^>]*>(.*?)</ul>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return convertListItems(groups[1], ordered: false)
        }
        working = working.replacingMatches(of: #"<ol[^>]*>(.*?)</ol>"#, options: [.caseInsensitive, .dotMatchesLineSeparators]) { groups in
            guard groups.count == 2 else { return nil }
            return convertListItems(groups[1], ordered: true)
        }
        return working
    }

    private static func convertListItems(_ body: String, ordered: Bool) -> String {
        let itemPattern = #"<li[^>]*>(.*?)</li>"#
        let regex = try? NSRegularExpression(pattern: itemPattern, options: [.caseInsensitive, .dotMatchesLineSeparators])
        let nsBody = body as NSString
        let range = NSRange(location: 0, length: nsBody.length)
        var items: [String] = []
        regex?.enumerateMatches(in: body, options: [], range: range) { match, _, _ in
            guard let match, match.numberOfRanges >= 2 else { return }
            let content = nsBody.substring(with: match.range(at: 1))
            items.append(content.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        let lines: [String] = items.enumerated().map { index, content in
            ordered ? "\(index + 1). \(content)" : "- \(content)"
        }
        return "\n" + lines.joined(separator: "\n") + "\n"
    }
}

private extension String {
    func replacingMatches(
        of pattern: String,
        options: NSRegularExpression.Options = [],
        replacement: (_ groups: [String]) -> String?
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else {
            return self
        }
        let nsSelf = self as NSString
        var result = ""
        var lastEnd = 0
        let range = NSRange(location: 0, length: nsSelf.length)
        regex.enumerateMatches(in: self, options: [], range: range) { match, _, _ in
            guard let match else { return }
            let matchRange = match.range
            if matchRange.location > lastEnd {
                result += nsSelf.substring(with: NSRange(location: lastEnd, length: matchRange.location - lastEnd))
            }
            var groups: [String] = []
            for i in 0..<match.numberOfRanges {
                let r = match.range(at: i)
                if r.location == NSNotFound {
                    groups.append("")
                } else {
                    groups.append(nsSelf.substring(with: r))
                }
            }
            if let sub = replacement(groups) {
                result += sub
            } else {
                result += nsSelf.substring(with: matchRange)
            }
            lastEnd = matchRange.location + matchRange.length
        }
        if lastEnd < nsSelf.length {
            result += nsSelf.substring(with: NSRange(location: lastEnd, length: nsSelf.length - lastEnd))
        }
        return result
    }
}
