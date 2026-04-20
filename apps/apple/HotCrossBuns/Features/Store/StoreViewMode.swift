import Foundation

// TODO: prune — dead after the Calendar/Tasks/Notes sidebar refactor.
// StoreView is Kanban-only now; the view-mode picker, list view, and the
// hiddenStoreViewModes Layout toggle were all removed. This enum plus its
// Settings setter (AppModel.setStoreViewModeHidden) and persisted field
// (AppSettings.hiddenStoreViewModes) stay in the project only because
// deleting the file requires a pbxproj edit. Safe to delete wholesale.

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
