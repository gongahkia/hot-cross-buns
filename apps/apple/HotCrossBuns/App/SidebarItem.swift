import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case today
    case forecast
    case review
    case overdue
    case dueToday
    case next7Days
    case noDate
    case tasks
    case calendar
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .forecast: "Forecast"
        case .review: "Review"
        case .overdue: "Overdue"
        case .dueToday: "Due Today"
        case .next7Days: "Next 7 Days"
        case .noDate: "No Date"
        case .tasks: "Tasks"
        case .calendar: "Calendar"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .today: "sun.max"
        case .forecast: "calendar.day.timeline.leading"
        case .review: "checklist.checked"
        case .overdue: "exclamationmark.circle"
        case .dueToday: "calendar.badge.clock"
        case .next7Days: "calendar.circle"
        case .noDate: "tray"
        case .tasks: "checklist"
        case .calendar: "calendar"
        case .settings: "gearshape"
        }
    }

    var keyboardEquivalent: KeyEquivalent? {
        switch self {
        case .today: "1"
        case .tasks: "2"
        case .calendar: "3"
        case .settings: "4"
        default: nil
        }
    }

    var section: SidebarSection {
        switch self {
        case .today, .forecast, .review, .calendar: .planner
        case .overdue, .dueToday, .next7Days, .noDate: .smartLists
        case .tasks: .lists
        case .settings: .utilities
        }
    }

    @MainActor
    @ViewBuilder
    func makeContentView() -> some View {
        switch self {
        case .today:
            TodayView()
        case .forecast:
            ForecastTimelineView()
        case .review:
            ReviewView()
        case .overdue:
            SmartListView(filter: .overdue)
        case .dueToday:
            SmartListView(filter: .dueToday)
        case .next7Days:
            SmartListView(filter: .next7Days)
        case .noDate:
            SmartListView(filter: .noDate)
        case .tasks:
            TasksView()
        case .calendar:
            CalendarHomeView()
        case .settings:
            SettingsView()
        }
    }
}

enum SidebarSection: String, CaseIterable, Hashable {
    case planner
    case smartLists
    case custom
    case lists
    case utilities

    var title: String {
        switch self {
        case .planner: "Planner"
        case .smartLists: "Smart Lists"
        case .custom: "Custom"
        case .lists: "Lists"
        case .utilities: ""
        }
    }

    var items: [SidebarItem] {
        SidebarItem.allCases.filter { $0.section == self }
    }
}
