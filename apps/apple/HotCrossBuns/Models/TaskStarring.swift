import Foundation

enum TaskStarring {
    static let marker = "⭐ "

    static func isStarred(_ task: TaskMirror) -> Bool {
        task.title.hasPrefix(marker)
    }

    static func displayTitle(for task: TaskMirror) -> String {
        guard isStarred(task) else { return task.title }
        return String(task.title.dropFirst(marker.count))
    }

    static func toggledTitle(for task: TaskMirror) -> String {
        if isStarred(task) {
            return displayTitle(for: task)
        }
        return marker + task.title
    }
}
