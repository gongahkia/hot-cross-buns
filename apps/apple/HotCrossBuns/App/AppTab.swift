import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case today
    case tasks
    case calendar
    case settings

    var id: String { rawValue }

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
        case .settings:
            SettingsView()
        }
    }

    @MainActor
    @ViewBuilder
    var label: some View {
        switch self {
        case .today:
            Label("Today", systemImage: "sun.max")
        case .tasks:
            Label("Tasks", systemImage: "checklist")
        case .calendar:
            Label("Calendar", systemImage: "calendar")
        case .settings:
            Label("Settings", systemImage: "gearshape")
        }
    }
}
