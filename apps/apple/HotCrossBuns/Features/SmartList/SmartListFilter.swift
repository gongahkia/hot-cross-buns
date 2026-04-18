import Foundation

enum SmartListFilter: String, Hashable, CaseIterable, Sendable {
    case overdue
    case dueToday
    case next7Days
    case noDate

    var title: String {
        switch self {
        case .overdue: "Overdue"
        case .dueToday: "Due Today"
        case .next7Days: "Next 7 Days"
        case .noDate: "No Date"
        }
    }

    var systemImage: String {
        switch self {
        case .overdue: "exclamationmark.circle"
        case .dueToday: "calendar.badge.clock"
        case .next7Days: "calendar.circle"
        case .noDate: "tray"
        }
    }

    var emptyStateTitle: String {
        switch self {
        case .overdue: "Nothing overdue"
        case .dueToday: "Nothing due today"
        case .next7Days: "Nothing due in the next 7 days"
        case .noDate: "Every task has a date"
        }
    }

    var emptyStateMessage: String {
        switch self {
        case .overdue: "Tasks past their due date will show up here."
        case .dueToday: "Tasks due today will show up here. Focus and finish."
        case .next7Days: "Tasks due in the week ahead will show up here."
        case .noDate: "Tasks without a due date land here so you can schedule them."
        }
    }

    func includes(_ task: TaskMirror, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard task.isDeleted == false else { return false }
        guard task.isCompleted == false else { return false }

        let startOfToday = calendar.startOfDay(for: now)

        switch self {
        case .overdue:
            guard let due = task.dueDate else { return false }
            return calendar.startOfDay(for: due) < startOfToday
        case .dueToday:
            guard let due = task.dueDate else { return false }
            return calendar.startOfDay(for: due) == startOfToday
        case .next7Days:
            guard let due = task.dueDate else { return false }
            let startOfDue = calendar.startOfDay(for: due)
            guard let horizon = calendar.date(byAdding: .day, value: 7, to: startOfToday) else { return false }
            return startOfDue >= startOfToday && startOfDue < horizon
        case .noDate:
            return task.dueDate == nil
        }
    }

    func apply(to tasks: [TaskMirror], now: Date = Date(), calendar: Calendar = .current) -> [TaskMirror] {
        tasks
            .filter { includes($0, now: now, calendar: calendar) }
            .sorted { lhs, rhs in
                switch (lhs.dueDate, rhs.dueDate) {
                case let (l?, r?): return l < r
                case (nil, _?): return false
                case (_?, nil): return true
                case (nil, nil): return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
                }
            }
    }

    func count(in tasks: [TaskMirror], now: Date = Date(), calendar: Calendar = .current) -> Int {
        tasks.reduce(0) { $0 + (includes($1, now: now, calendar: calendar) ? 1 : 0) }
    }
}
