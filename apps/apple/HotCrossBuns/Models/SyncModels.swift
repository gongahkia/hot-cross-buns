import Foundation

enum SyncMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case manual
    case balanced
    case nearRealtime

    var id: String { rawValue }

    var title: String {
        switch self {
        case .manual:
            "Manual"
        case .balanced:
            "Balanced"
        case .nearRealtime:
            "Near real-time"
        }
    }

    var detail: String {
        switch self {
        case .manual:
            "Only refresh when requested."
        case .balanced:
            "Refresh on launch, foreground, and periodic app activity."
        case .nearRealtime:
            "Poll more aggressively while foregrounded with backoff."
        }
    }
}

enum SyncState: Equatable, Sendable {
    case idle
    case syncing(startedAt: Date)
    case synced(at: Date)
    case failed(message: String)

    var title: String {
        switch self {
        case .idle:
            "Ready"
        case .syncing:
            "Syncing"
        case .synced:
            "Synced"
        case .failed:
            "Sync failed"
        }
    }
}

struct SyncCheckpoint: Identifiable, Hashable, Codable, Sendable {
    let id: String
    var accountID: GoogleAccount.ID
    var resourceType: SyncResourceType
    var resourceID: String
    var calendarSyncToken: String?
    var tasksUpdatedMin: Date?
    var lastSuccessfulSyncAt: Date?
}

extension SyncCheckpoint {
    static func stableID(
        accountID: GoogleAccount.ID,
        resourceType: SyncResourceType,
        resourceID: String
    ) -> String {
        "\(accountID)::\(resourceType.rawValue)::\(resourceID)"
    }
}

enum SyncResourceType: String, Hashable, Codable, Sendable {
    case taskList
    case calendar
    case task
    case event
}

struct PendingMutation: Identifiable, Hashable, Codable, Sendable {
    let id: UUID
    var createdAt: Date
    var resourceType: SyncResourceType
    var resourceID: String
    var action: PendingMutationAction
    var payload: Data
}

enum PendingMutationAction: String, Hashable, Codable, Sendable {
    case create
    case update
    case completion
    case delete
}

struct AppSettings: Hashable, Codable, Sendable {
    var syncMode: SyncMode
    var selectedCalendarIDs: Set<CalendarListMirror.ID>
    var selectedTaskListIDs: Set<TaskListMirror.ID>
    var hasConfiguredCalendarSelection: Bool
    var hasConfiguredTaskListSelection: Bool
    var enableLocalNotifications: Bool
    var hasCompletedOnboarding: Bool
    var showMenuBarExtra: Bool
    var showDetailedMenuBar: Bool
    var showDockBadge: Bool
    var enableVimKeybindings: Bool
    var enableGlobalHotkey: Bool
    var customFilters: [CustomFilterDefinition]
    var eventTemplates: [EventTemplate]
    var menuBarStyle: MenuBarStyle
    var uiLayoutScale: Double // 0.80–1.50, geometric scale of UI chrome only (not text)
    var uiTextSizeStep: Int // 0–6 ladder index into HCBTextSizeLadder
    var uiFontName: String? // PostScript name, nil for system

    init(
        syncMode: SyncMode,
        selectedCalendarIDs: Set<CalendarListMirror.ID>,
        selectedTaskListIDs: Set<TaskListMirror.ID>,
        hasConfiguredCalendarSelection: Bool = false,
        hasConfiguredTaskListSelection: Bool = false,
        enableLocalNotifications: Bool,
        hasCompletedOnboarding: Bool = false,
        showMenuBarExtra: Bool = true,
        showDetailedMenuBar: Bool = false,
        showDockBadge: Bool = true,
        enableVimKeybindings: Bool = false,
        enableGlobalHotkey: Bool = true,
        customFilters: [CustomFilterDefinition] = [],
        eventTemplates: [EventTemplate] = [],
        menuBarStyle: MenuBarStyle = .compact,
        uiLayoutScale: Double = 1.0,
        uiTextSizeStep: Int = 3,
        uiFontName: String? = nil
    ) {
        self.syncMode = syncMode
        self.selectedCalendarIDs = selectedCalendarIDs
        self.selectedTaskListIDs = selectedTaskListIDs
        self.hasConfiguredCalendarSelection = hasConfiguredCalendarSelection
        self.hasConfiguredTaskListSelection = hasConfiguredTaskListSelection
        self.enableLocalNotifications = enableLocalNotifications
        self.hasCompletedOnboarding = hasCompletedOnboarding
        self.showMenuBarExtra = showMenuBarExtra
        self.showDetailedMenuBar = showDetailedMenuBar
        self.showDockBadge = showDockBadge
        self.enableVimKeybindings = enableVimKeybindings
        self.enableGlobalHotkey = enableGlobalHotkey
        self.customFilters = customFilters
        self.eventTemplates = eventTemplates
        self.menuBarStyle = menuBarStyle
        self.uiLayoutScale = uiLayoutScale
        self.uiTextSizeStep = uiTextSizeStep
        self.uiFontName = uiFontName
    }

    enum CodingKeys: String, CodingKey {
        case syncMode
        case selectedCalendarIDs
        case selectedTaskListIDs
        case hasConfiguredCalendarSelection
        case hasConfiguredTaskListSelection
        case enableLocalNotifications
        case hasCompletedOnboarding
        case showMenuBarExtra
        case showDetailedMenuBar
        case showDockBadge
        case enableVimKeybindings
        case enableGlobalHotkey
        case customFilters
        case eventTemplates
        case menuBarStyle
        case uiLayoutScale
        case uiTextSizeStep
        case uiFontName
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        syncMode = try container.decodeIfPresent(SyncMode.self, forKey: .syncMode) ?? .balanced
        selectedCalendarIDs = try container.decodeIfPresent(Set<CalendarListMirror.ID>.self, forKey: .selectedCalendarIDs) ?? []
        selectedTaskListIDs = try container.decodeIfPresent(Set<TaskListMirror.ID>.self, forKey: .selectedTaskListIDs) ?? []
        hasConfiguredCalendarSelection = try container.decodeIfPresent(Bool.self, forKey: .hasConfiguredCalendarSelection) ?? false
        hasConfiguredTaskListSelection = try container.decodeIfPresent(Bool.self, forKey: .hasConfiguredTaskListSelection) ?? false
        enableLocalNotifications = try container.decodeIfPresent(Bool.self, forKey: .enableLocalNotifications) ?? false
        hasCompletedOnboarding = try container.decodeIfPresent(Bool.self, forKey: .hasCompletedOnboarding) ?? false
        showMenuBarExtra = try container.decodeIfPresent(Bool.self, forKey: .showMenuBarExtra) ?? true
        showDetailedMenuBar = try container.decodeIfPresent(Bool.self, forKey: .showDetailedMenuBar) ?? false
        showDockBadge = try container.decodeIfPresent(Bool.self, forKey: .showDockBadge) ?? true
        enableVimKeybindings = try container.decodeIfPresent(Bool.self, forKey: .enableVimKeybindings) ?? false
        enableGlobalHotkey = try container.decodeIfPresent(Bool.self, forKey: .enableGlobalHotkey) ?? true
        customFilters = try container.decodeIfPresent([CustomFilterDefinition].self, forKey: .customFilters) ?? []
        eventTemplates = try container.decodeIfPresent([EventTemplate].self, forKey: .eventTemplates) ?? []
        if let explicit = try container.decodeIfPresent(MenuBarStyle.self, forKey: .menuBarStyle) {
            menuBarStyle = explicit
        } else {
            // Migrate legacy showDetailedMenuBar bool into the new style enum
            menuBarStyle = showDetailedMenuBar ? .detailed : .compact
        }
        uiLayoutScale = try container.decodeIfPresent(Double.self, forKey: .uiLayoutScale) ?? 1.0
        uiTextSizeStep = try container.decodeIfPresent(Int.self, forKey: .uiTextSizeStep) ?? 3
        uiFontName = try container.decodeIfPresent(String.self, forKey: .uiFontName)
    }

    enum MenuBarStyle: String, Codable, Hashable, Sendable, CaseIterable {
        case compact
        case detailed
        case weekly
        case focusStrip
        case dayTimeline
        case minimalBadge

        var title: String {
            switch self {
            case .compact: "Compact"
            case .detailed: "Calendar"
            case .weekly: "Week-at-a-glance"
            case .focusStrip: "Focus strip"
            case .dayTimeline: "Day timeline"
            case .minimalBadge: "Minimal badges"
            }
        }
    }

    static let `default` = AppSettings(
        syncMode: .balanced,
        selectedCalendarIDs: [],
        selectedTaskListIDs: [],
        enableLocalNotifications: false,
        hasCompletedOnboarding: false
    )
}
