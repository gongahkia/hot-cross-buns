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
    // Poison-pill tracking (added in B). attemptCount increments on every
    // transient failure; lastAttemptAt gates replay until the backoff window
    // passes; quarantinedAt moves the mutation out of the automatic replay
    // loop after BackoffPolicy.maxAttempts failures. Codable decodeIfPresent
    // back-compat: pre-B queued mutations decode with zeroes and are treated
    // as fresh.
    var attemptCount: Int = 0
    var lastAttemptAt: Date? = nil
    var lastErrorSummary: String? = nil
    var quarantinedAt: Date? = nil
    // Set when the mutation was quarantined specifically because the server
    // returned 412 Precondition Failed (the canonical "someone else edited
    // this resource" signal). Drives the conflict-resolution UI — the user
    // can either force-overwrite (re-issue without etag) or discard.
    var conflictedAt: Date? = nil

    enum CodingKeys: String, CodingKey {
        case id, createdAt, resourceType, resourceID, action, payload
        case attemptCount, lastAttemptAt, lastErrorSummary, quarantinedAt, conflictedAt
    }

    init(
        id: UUID,
        createdAt: Date,
        resourceType: SyncResourceType,
        resourceID: String,
        action: PendingMutationAction,
        payload: Data,
        attemptCount: Int = 0,
        lastAttemptAt: Date? = nil,
        lastErrorSummary: String? = nil,
        quarantinedAt: Date? = nil,
        conflictedAt: Date? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.resourceType = resourceType
        self.resourceID = resourceID
        self.action = action
        self.payload = payload
        self.attemptCount = attemptCount
        self.lastAttemptAt = lastAttemptAt
        self.lastErrorSummary = lastErrorSummary
        self.quarantinedAt = quarantinedAt
        self.conflictedAt = conflictedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        resourceType = try c.decode(SyncResourceType.self, forKey: .resourceType)
        resourceID = try c.decode(String.self, forKey: .resourceID)
        action = try c.decode(PendingMutationAction.self, forKey: .action)
        payload = try c.decode(Data.self, forKey: .payload)
        attemptCount = try c.decodeIfPresent(Int.self, forKey: .attemptCount) ?? 0
        lastAttemptAt = try c.decodeIfPresent(Date.self, forKey: .lastAttemptAt)
        lastErrorSummary = try c.decodeIfPresent(String.self, forKey: .lastErrorSummary)
        quarantinedAt = try c.decodeIfPresent(Date.self, forKey: .quarantinedAt)
        conflictedAt = try c.decodeIfPresent(Date.self, forKey: .conflictedAt)
    }

    var isQuarantined: Bool { quarantinedAt != nil }
    var isConflict: Bool { conflictedAt != nil }

    // Returns true when the backoff window has elapsed (or no prior attempt).
    // A mutation becomes eligible for retry `policy.delay(forAttempt:)` after
    // its `lastAttemptAt`. Quarantined mutations never auto-replay.
    func isReadyToReplay(now: Date, policy: BackoffPolicy) -> Bool {
        guard isQuarantined == false else { return false }
        guard let last = lastAttemptAt else { return true }
        let delay = policy.delay(forAttempt: max(0, attemptCount - 1))
        let secs = Double(delay.components.seconds) + Double(delay.components.attoseconds) / 1e18
        return now.timeIntervalSince(last) >= secs
    }
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
    var enableGlobalHotkey: Bool
    var customFilters: [CustomFilterDefinition]
    var eventTemplates: [EventTemplate]
    var menuBarStyle: MenuBarStyle
    var uiLayoutScale: Double // 0.80–1.50, geometric scale of UI chrome only (not text)
    var uiTextSizePoints: Double // literal body-text point size (9–24), drives every semantic style
    var uiFontName: String? // PostScript name, nil for system
    var colorSchemeID: String // identifier into HCBColorScheme.all
    var shortcutOverrides: [String: HCBKeyBinding] // HCBShortcutCommand.rawValue → binding
    var hiddenSidebarItems: Set<String> // SidebarItem.rawValues user has hidden (Settings never hidable)
    var hiddenCalendarViewModes: Set<String> // CalendarGridMode.rawValues user has hidden from Calendar picker
    // TODO: prune — dead after the Calendar/Tasks/Notes sidebar refactor.
    // StoreView is Kanban-only; the hide/show picker went with it. Drop
    // alongside StoreViewMode + setStoreViewModeHidden.
    var hiddenStoreViewModes: Set<String>
    var perSurfaceFontOverrides: [String: HCBSurfaceFontOverride] // HCBSurface.rawValue → override
    var cacheEncryptionEnabled: Bool // §6.12 — whether LocalCacheStore should encrypt at rest
    var taskTemplates: [TaskTemplate] // §6.13 — local-only task templates with variable expansion
    var eventRetentionDaysBack: Int // §7.02 — drop events with endDate older than (now - N days) during sync merge; 0 = keep forever
    var collapsedTaskListIDs: Set<TaskListMirror.ID> // §7.01 — task-list section IDs the user has folded shut in StoreView
    var multiDayCount: Int // §7.01 Phase D2 — day count for Multi-Day view (2-7, default 3)
    var quickCreateExpandedByDefault: Bool // §7.01 follow-up — show all QuickCreate fields up-front instead of behind [+ More]
    // App-wide task reminder policy. Per-task offsets were removed in F-reminders
    // because Google Tasks API has no reminder field and writing offsets into
    // notes violated the "no new schema Google has to read" invariant. Now every
    // open task with a due date fires a single local notification at
    // `due - thresholdDays` on this Mac at taskReminderHour:taskReminderMinute.
    // 0 = disabled. Defaults: 7 days before, 09:00.
    var taskReminderThresholdDays: Int
    var taskReminderHour: Int
    var taskReminderMinute: Int

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
        enableGlobalHotkey: Bool = true,
        customFilters: [CustomFilterDefinition] = [],
        eventTemplates: [EventTemplate] = [],
        menuBarStyle: MenuBarStyle = .compact,
        uiLayoutScale: Double = 1.0,
        uiTextSizePoints: Double = 13.0,
        uiFontName: String? = nil,
        colorSchemeID: String = "notion",
        shortcutOverrides: [String: HCBKeyBinding] = [:],
        hiddenSidebarItems: Set<String> = [],
        hiddenCalendarViewModes: Set<String> = [],
        hiddenStoreViewModes: Set<String> = [],
        perSurfaceFontOverrides: [String: HCBSurfaceFontOverride] = [:],
        cacheEncryptionEnabled: Bool = false,
        taskTemplates: [TaskTemplate] = [],
        eventRetentionDaysBack: Int = 365,
        collapsedTaskListIDs: Set<TaskListMirror.ID> = [],
        multiDayCount: Int = 3,
        quickCreateExpandedByDefault: Bool = true,
        taskReminderThresholdDays: Int = 7,
        taskReminderHour: Int = 9,
        taskReminderMinute: Int = 0
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
        self.enableGlobalHotkey = enableGlobalHotkey
        self.customFilters = customFilters
        self.eventTemplates = eventTemplates
        self.menuBarStyle = menuBarStyle
        self.uiLayoutScale = uiLayoutScale
        self.uiTextSizePoints = uiTextSizePoints
        self.uiFontName = uiFontName
        self.colorSchemeID = colorSchemeID
        self.shortcutOverrides = shortcutOverrides
        self.hiddenSidebarItems = hiddenSidebarItems
        self.hiddenCalendarViewModes = hiddenCalendarViewModes
        self.hiddenStoreViewModes = hiddenStoreViewModes
        self.perSurfaceFontOverrides = perSurfaceFontOverrides
        self.cacheEncryptionEnabled = cacheEncryptionEnabled
        self.taskTemplates = taskTemplates
        self.eventRetentionDaysBack = eventRetentionDaysBack
        self.collapsedTaskListIDs = collapsedTaskListIDs
        self.multiDayCount = max(2, min(7, multiDayCount))
        self.quickCreateExpandedByDefault = quickCreateExpandedByDefault
        self.taskReminderThresholdDays = max(0, min(365, taskReminderThresholdDays))
        self.taskReminderHour = max(0, min(23, taskReminderHour))
        self.taskReminderMinute = max(0, min(59, taskReminderMinute))
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
        case enableGlobalHotkey
        case customFilters
        case eventTemplates
        case menuBarStyle
        case uiLayoutScale
        case uiTextSizePoints
        case uiFontName
        case colorSchemeID
        case shortcutOverrides
        case hiddenSidebarItems
        case hiddenCalendarViewModes
        case hiddenStoreViewModes
        case perSurfaceFontOverrides
        case cacheEncryptionEnabled
        case taskTemplates
        case eventRetentionDaysBack
        case collapsedTaskListIDs
        case multiDayCount
        case quickCreateExpandedByDefault
        case taskReminderThresholdDays
        case taskReminderHour
        case taskReminderMinute
    }

    // Legacy key (0-6 ladder) read via dynamic CodingKey so it stays out of
    // synthesized encode(to:) while still being readable by init(from:).
    private struct LegacyKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
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
        if let points = try container.decodeIfPresent(Double.self, forKey: .uiTextSizePoints) {
            uiTextSizePoints = points
        } else if
            let legacyContainer = try? decoder.container(keyedBy: LegacyKey.self),
            let legacyKey = LegacyKey(stringValue: "uiTextSizeStep"),
            let legacyStep = try legacyContainer.decodeIfPresent(Int.self, forKey: legacyKey)
        {
            // Migrate 0-6 ladder to literal points. Prior mapping:
            // xSmall=11, small=12, medium=12, large=13, xLarge=15, xxLarge=17, xxxLarge=19.
            let ladder: [Double] = [11, 12, 12, 13, 15, 17, 19]
            uiTextSizePoints = ladder[max(0, min(legacyStep, ladder.count - 1))]
        } else {
            uiTextSizePoints = 13.0
        }
        uiFontName = try container.decodeIfPresent(String.self, forKey: .uiFontName)
        colorSchemeID = try container.decodeIfPresent(String.self, forKey: .colorSchemeID) ?? "notion"
        shortcutOverrides = try container.decodeIfPresent([String: HCBKeyBinding].self, forKey: .shortcutOverrides) ?? [:]
        hiddenSidebarItems = try container.decodeIfPresent(Set<String>.self, forKey: .hiddenSidebarItems) ?? []
        hiddenCalendarViewModes = try container.decodeIfPresent(Set<String>.self, forKey: .hiddenCalendarViewModes) ?? []
        hiddenStoreViewModes = try container.decodeIfPresent(Set<String>.self, forKey: .hiddenStoreViewModes) ?? []
        perSurfaceFontOverrides = try container.decodeIfPresent([String: HCBSurfaceFontOverride].self, forKey: .perSurfaceFontOverrides) ?? [:]
        cacheEncryptionEnabled = try container.decodeIfPresent(Bool.self, forKey: .cacheEncryptionEnabled) ?? false
        taskTemplates = try container.decodeIfPresent([TaskTemplate].self, forKey: .taskTemplates) ?? []
        eventRetentionDaysBack = try container.decodeIfPresent(Int.self, forKey: .eventRetentionDaysBack) ?? 365
        collapsedTaskListIDs = try container.decodeIfPresent(Set<TaskListMirror.ID>.self, forKey: .collapsedTaskListIDs) ?? []
        let rawMultiDay = try container.decodeIfPresent(Int.self, forKey: .multiDayCount) ?? 3
        multiDayCount = max(2, min(7, rawMultiDay))
        quickCreateExpandedByDefault = try container.decodeIfPresent(Bool.self, forKey: .quickCreateExpandedByDefault) ?? true
        let rawThreshold = try container.decodeIfPresent(Int.self, forKey: .taskReminderThresholdDays) ?? 7
        taskReminderThresholdDays = max(0, min(365, rawThreshold))
        let rawHour = try container.decodeIfPresent(Int.self, forKey: .taskReminderHour) ?? 9
        taskReminderHour = max(0, min(23, rawHour))
        let rawMinute = try container.decodeIfPresent(Int.self, forKey: .taskReminderMinute) ?? 0
        taskReminderMinute = max(0, min(59, rawMinute))
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
