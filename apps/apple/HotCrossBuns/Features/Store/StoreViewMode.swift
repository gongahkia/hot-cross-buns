import Foundation

// Top-level layout mode for the Store tab. The user picks between the
// existing List view (grouped by task list / smart list / custom filter) and
// the new Kanban board. Individual modes are hideable via §6.1 Layout —
// power users who don't want Kanban can turn it off entirely.
enum StoreViewMode: String, CaseIterable, Hashable, Sendable {
    case list
    case kanban

    var title: String {
        switch self {
        case .list: "List"
        case .kanban: "Kanban"
        }
    }

    var systemImage: String {
        switch self {
        case .list: "list.bullet"
        case .kanban: "rectangle.3.group"
        }
    }
}
