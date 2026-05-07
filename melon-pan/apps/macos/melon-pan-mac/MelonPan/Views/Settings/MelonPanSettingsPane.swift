import Foundation

enum MelonPanSettingsPane: String, CaseIterable, Identifiable {
    case general
    case editor
    case workspace
    case sync
    case accounts
    case keys
    case privacy
    case updates
    case history
    case advanced

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .editor: return "Editor"
        case .workspace: return "Workspace"
        case .sync: return "Sync"
        case .accounts: return "Accounts"
        case .keys: return "Keys"
        case .privacy: return "Privacy"
        case .updates: return "Updates"
        case .history: return "History"
        case .advanced: return "Advanced"
        }
    }

    var systemImage: String {
        switch self {
        case .general: return "gearshape"
        case .editor: return "text.cursor"
        case .workspace: return "sidebar.left"
        case .sync: return "arrow.triangle.2.circlepath"
        case .accounts: return "person.crop.circle"
        case .keys: return "keyboard"
        case .privacy: return "lock.shield"
        case .updates: return "arrow.down.circle"
        case .history: return "clock"
        case .advanced: return "gearshape.2"
        }
    }

    var settingsTab: SettingsTab {
        switch self {
        case .general: return .general
        case .editor: return .editor
        case .workspace: return .workspace
        case .sync: return .sync
        case .accounts: return .accounts
        case .keys: return .keybindings
        case .privacy: return .privacy
        case .updates: return .updates
        case .history: return .history
        case .advanced: return .advanced
        }
    }

    init(section: String?) {
        switch section?.lowercased() {
        case "account", "accounts", "oauth":
            self = .accounts
        case "editor", "appearance":
            self = .editor
        case "workspace", "drive", "sidebar", "visibility":
            self = .workspace
        case "sync":
            self = .sync
        case "keys", "keybindings", "shortcuts":
            self = .keys
        case "privacy", "security", "encryption":
            self = .privacy
        case "history":
            self = .history
        case "updates", "about":
            self = .updates
        case "advanced", "diagnostics":
            self = .advanced
        default:
            self = .general
        }
    }
}

final class SettingsPaneSelection: ObservableObject {
    @Published var pane: MelonPanSettingsPane

    init(pane: MelonPanSettingsPane = .general) {
        self.pane = pane
    }
}
