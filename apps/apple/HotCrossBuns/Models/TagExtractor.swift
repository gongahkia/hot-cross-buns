import Foundation

enum TagExtractor {
    private static let pattern = "#([A-Za-z0-9_\\-]{1,40})"

    static func tags(in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, range: range)
        return matches.compactMap { match -> String? in
            guard match.numberOfRanges >= 2, let r = Range(match.range(at: 1), in: text) else { return nil }
            return String(text[r])
        }
    }

    static func stripped(from text: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        let cleaned = regex.stringByReplacingMatches(in: text, range: range, withTemplate: "")
        return cleaned
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
