import Foundation

enum TaskRecurrenceMarkers {
    private static let pattern = "\\[recurrence:\\s*([^\\]]+)\\]"

    static func rule(from notes: String) -> RecurrenceRule? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: notes, range: NSRange(notes.startIndex..., in: notes)),
              match.numberOfRanges >= 2,
              let r = Range(match.range(at: 1), in: notes) else {
            return nil
        }
        return RecurrenceRule.parse(rrule: String(notes[r]))
    }

    static func strippedNotes(from notes: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return notes }
        let range = NSRange(notes.startIndex..., in: notes)
        return regex
            .stringByReplacingMatches(in: notes, range: range, withTemplate: "")
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func encode(notes: String, rule: RecurrenceRule?) -> String {
        let base = strippedNotes(from: notes)
        guard let rule else { return base }
        let marker = "[recurrence: \(rule.rruleString())]"
        if base.isEmpty { return marker }
        return base + "\n\n" + marker
    }
}
