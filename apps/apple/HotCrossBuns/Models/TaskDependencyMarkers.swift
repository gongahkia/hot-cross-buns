import Foundation

// Encodes a list of blocker task IDs at the end of the notes field.
// Stored form: [blocked-by: id1, id2, id3]
// Google Tasks has no native dependency field, so we roundtrip this
// through the notes body — visible to other clients but harmless.
enum TaskDependencyMarkers {
    private static let pattern = "\\[blocked-by:\\s*([^\\]]+)\\]"

    static func blockerIDs(from notes: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: notes, range: NSRange(notes.startIndex..., in: notes)),
              match.numberOfRanges >= 2,
              let r = Range(match.range(at: 1), in: notes) else {
            return []
        }
        return String(notes[r])
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
    }

    static func strippedNotes(from notes: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return notes }
        let range = NSRange(notes.startIndex..., in: notes)
        return regex
            .stringByReplacingMatches(in: notes, range: range, withTemplate: "")
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func encode(notes: String, blockerIDs: [String]) -> String {
        let base = strippedNotes(from: notes)
        let cleaned = blockerIDs.filter { $0.isEmpty == false }
        guard cleaned.isEmpty == false else { return base }
        let marker = "[blocked-by: \(cleaned.joined(separator: ", "))]"
        if base.isEmpty { return marker }
        return base + "\n\n" + marker
    }

    static func isBlocked(_ task: TaskMirror, allTasks: [TaskMirror]) -> Bool {
        let blockers = blockerIDs(from: task.notes)
        guard blockers.isEmpty == false else { return false }
        let byID = Dictionary(uniqueKeysWithValues: allTasks.map { ($0.id, $0) })
        return blockers.contains { id in
            guard let blocker = byID[id] else { return false }
            return blocker.isCompleted == false && blocker.isDeleted == false
        }
    }
}
