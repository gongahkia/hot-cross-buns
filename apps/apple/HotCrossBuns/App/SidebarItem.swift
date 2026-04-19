import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case calendar
    case store
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .calendar: "Calendar"
        case .store: "Store"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .calendar: "calendar"
        case .store: "brain.head.profile" // covers tasks + notes
        case .settings: "gearshape"
        }
    }

    var keyboardEquivalent: KeyEquivalent? {
        switch self {
        case .calendar: "1"
        case .store: "2"
        case .settings: nil
        }
    }

    // Settings stays always visible so the user can always reach the Layout
    // section to unhide other tabs. Calendar and Store are user-hideable.
    var isHideable: Bool {
        switch self {
        case .calendar, .store: true
        case .settings: false
        }
    }

    @MainActor
    @ViewBuilder
    func makeContentView() -> some View {
        switch self {
        case .calendar:
            CalendarHomeView()
        case .store:
            StoreView()
        case .settings:
            SettingsView()
        }
    }
}

extension Notification.Name {
    // Posted when any part of the app wants to switch the sidebar to the
    // Settings tab (e.g., the "Open Settings" button in Calendar's empty
    // state). MacSidebarShell observes this and updates selection.
    static let hcbOpenSettingsTab = Notification.Name("hcb.open.settings.tab")
}
