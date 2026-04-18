import Foundation

enum TaskReminderMarkers {
    private static let pattern = "\\[reminders:\\s*([^\\]]+)\\]"

    static func offsetsInDays(from notes: String) -> [Int] {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: notes, range: NSRange(notes.startIndex..., in: notes)),
              match.numberOfRanges >= 2,
              let r = Range(match.range(at: 1), in: notes) else {
            return []
        }
        let raw = String(notes[r])
        return raw
            .split(separator: ",")
            .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    }

    static func strippedNotes(from notes: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return notes }
        let range = NSRange(notes.startIndex..., in: notes)
        return regex
            .stringByReplacingMatches(in: notes, range: range, withTemplate: "")
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func encode(notes: String, offsetsInDays: [Int]) -> String {
        let base = strippedNotes(from: notes)
        guard offsetsInDays.isEmpty == false else { return base }
        let sorted = offsetsInDays.sorted()
        let marker = "[reminders: \(sorted.map(String.init).joined(separator: ", "))]"
        if base.isEmpty { return marker }
        return base + "\n\n" + marker
    }
}
