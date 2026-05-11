import Foundation

enum TagExtractor {
    private static let pattern = #"(?<![A-Za-z0-9_])#([A-Za-z0-9_\-]{1,40})(?![A-Za-z0-9_\-])"#
    private static let numericDashPattern = #"^\d+(?:-\d+)+$"#

    private struct Match {
        let tag: String
        let range: Range<String.Index>
    }

    static func tags(in text: String) -> [String] {
        matches(in: text).map(\.tag)
    }

    static func firstTag(in text: String) -> (tag: String, range: Range<String.Index>)? {
        guard let match = matches(in: text).first else { return nil }
        return (match.tag, match.range)
    }

    static func stripped(from text: String) -> String {
        let matches = matches(in: text)
        guard matches.isEmpty == false else { return text }
        var cleaned = text
        for match in matches.reversed() {
            cleaned.removeSubrange(match.range)
        }
        return cleaned
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func matches(in text: String) -> [Match] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match -> Match? in
            guard match.numberOfRanges >= 2,
                  let tagRange = Range(match.range(at: 1), in: text),
                  let fullRange = Range(match.range, in: text)
            else {
                return nil
            }
            let tag = String(text[tagRange])
            guard isUserTag(tag) else { return nil }
            return Match(tag: tag, range: fullRange)
        }
    }

    private static func isUserTag(_ value: String) -> Bool {
        value.range(of: numericDashPattern, options: .regularExpression) == nil
    }
}
