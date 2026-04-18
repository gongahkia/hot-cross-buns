import Foundation

enum DueWindow: String, CaseIterable, Codable, Hashable, Sendable {
    case any
    case none
    case overdue
    case today
    case next7Days

    var title: String {
        switch self {
        case .any: "Any due"
        case .none: "No date"
        case .overdue: "Overdue"
        case .today: "Due today"
        case .next7Days: "Due in 7 days"
        }
    }
}

struct CustomFilterDefinition: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    var name: String
    var systemImage: String
    var dueWindow: DueWindow
    var starredOnly: Bool
    var includeCompleted: Bool
    var taskListIDs: Set<String>
    var tagsAny: [String]

    init(
        id: UUID = UUID(),
        name: String,
        systemImage: String = "line.3.horizontal.decrease.circle",
        dueWindow: DueWindow = .any,
        starredOnly: Bool = false,
        includeCompleted: Bool = false,
        taskListIDs: Set<String> = [],
        tagsAny: [String] = []
    ) {
        self.id = id
        self.name = name
        self.systemImage = systemImage
        self.dueWindow = dueWindow
        self.starredOnly = starredOnly
        self.includeCompleted = includeCompleted
        self.taskListIDs = taskListIDs
        self.tagsAny = tagsAny
    }

    func matches(
        _ task: TaskMirror,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Bool {
        guard task.isDeleted == false else { return false }
        if includeCompleted == false, task.isCompleted { return false }

        if taskListIDs.isEmpty == false, taskListIDs.contains(task.taskListID) == false {
            return false
        }

        if starredOnly, TaskStarring.isStarred(task) == false { return false }

        if tagsAny.isEmpty == false {
            let taskTags = Set(TagExtractor.tags(in: task.title).map { $0.lowercased() })
            let targetTags = Set(tagsAny.map { $0.lowercased() })
            if taskTags.isDisjoint(with: targetTags) { return false }
        }

        let startOfToday = calendar.startOfDay(for: now)
        switch dueWindow {
        case .any: return true
        case .none: return task.dueDate == nil
        case .overdue:
            guard let due = task.dueDate else { return false }
            return calendar.startOfDay(for: due) < startOfToday
        case .today:
            guard let due = task.dueDate else { return false }
            return calendar.startOfDay(for: due) == startOfToday
        case .next7Days:
            guard let due = task.dueDate else { return false }
            guard let horizon = calendar.date(byAdding: .day, value: 7, to: startOfToday) else { return false }
            let startOfDue = calendar.startOfDay(for: due)
            return startOfDue >= startOfToday && startOfDue < horizon
        }
    }
}
