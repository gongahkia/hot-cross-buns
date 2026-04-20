import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case calendar
    case store

    var id: String { rawValue }

    var title: String {
        switch self {
        case .calendar: "Calendar"
        case .store: "Store"
        }
    }

    var systemImage: String {
        switch self {
        case .calendar: "calendar"
        case .store: "brain.head.profile" // covers tasks + notes
        }
    }

    var keyboardEquivalent: KeyEquivalent? {
        switch self {
        case .calendar: "1"
        case .store: "2"
        }
    }

    // Both tabs are user-hideable. At least one must remain visible; the
    // toggle in Layout settings enforces that invariant.
    var isHideable: Bool {
        switch self {
        case .calendar, .store: true
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
        }
    }
}

extension Notification.Name {
    // Posted when any part of the app wants to switch the sidebar to the
    // Store tab. MacSidebarShell observes this and updates selection.
    static let hcbOpenStoreTab = Notification.Name("hcb.open.store.tab")
    // Posted by the "Settings…" menu command + ⌘,; AppDelegate opens the
    // detached Settings window in response.
    static let hcbOpenSettingsWindow = Notification.Name("hcb.open.settings.window")
}
