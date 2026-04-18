import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case today
    case tasks
    case calendar
    case search
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .tasks: "Tasks"
        case .calendar: "Calendar"
        case .search: "Search"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .today: "sun.max"
        case .tasks: "checklist"
        case .calendar: "calendar"
        case .search: "magnifyingglass"
        case .settings: "gearshape"
        }
    }

    var keyboardEquivalent: KeyEquivalent {
        switch self {
        case .today: "1"
        case .tasks: "2"
        case .calendar: "3"
        case .search: "4"
        case .settings: "5"
        }
    }

    @MainActor
    @ViewBuilder
    func makeContentView() -> some View {
        switch self {
        case .today:
            TodayView()
        case .tasks:
            TasksView()
        case .calendar:
            CalendarHomeView()
        case .search:
            SearchView()
        case .settings:
            SettingsView()
        }
    }
}
