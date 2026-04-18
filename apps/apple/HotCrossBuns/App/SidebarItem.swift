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
