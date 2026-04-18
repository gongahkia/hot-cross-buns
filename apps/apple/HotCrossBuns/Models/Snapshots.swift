import Foundation

struct TodaySnapshot: Equatable, Sendable {
    var date: Date
    var dueTasks: [TaskMirror]
    var scheduledEvents: [CalendarEventMirror]
    var overdueCount: Int

    static let empty = TodaySnapshot(date: Date(), dueTasks: [], scheduledEvents: [], overdueCount: 0)

    static func build(
        tasks: [TaskMirror],
        events: [CalendarEventMirror],
        referenceDate: Date,
        calendar: Calendar = .current
    ) -> TodaySnapshot {
        let dueTasks = tasks.filter { task in
            guard !task.isCompleted, !task.isDeleted, let dueDate = task.dueDate else {
                return false
            }
            return calendar.isDate(dueDate, inSameDayAs: referenceDate)
        }

        let overdueCount = tasks.filter { task in
            guard !task.isCompleted, !task.isDeleted, let dueDate = task.dueDate else {
                return false
            }
            return dueDate < calendar.startOfDay(for: referenceDate)
        }.count

        let scheduledEvents = events.filter { event in
            event.status != .cancelled && calendar.isDate(event.startDate, inSameDayAs: referenceDate)
        }.sorted { lhs, rhs in
            lhs.startDate < rhs.startDate
        }

        return TodaySnapshot(
            date: referenceDate,
            dueTasks: dueTasks,
            scheduledEvents: scheduledEvents,
            overdueCount: overdueCount
        )
    }
}

struct CalendarSnapshot: Equatable, Sendable {
    var selectedCalendars: [CalendarListMirror]
    var upcomingEvents: [CalendarEventMirror]

    static let empty = CalendarSnapshot(selectedCalendars: [], upcomingEvents: [])

    static func build(
        calendars: [CalendarListMirror],
        events: [CalendarEventMirror],
        referenceDate: Date
    ) -> CalendarSnapshot {
        let selectedCalendars = calendars.filter(\.isSelected)
        let selectedIDs = Set(selectedCalendars.map(\.id))
        let upcomingEvents = events
            .filter { event in
                event.status != .cancelled && selectedIDs.contains(event.calendarID) && event.endDate >= referenceDate
            }
            .sorted { lhs, rhs in
                lhs.startDate < rhs.startDate
            }

        return CalendarSnapshot(selectedCalendars: selectedCalendars, upcomingEvents: upcomingEvents)
    }
}

struct TaskListSectionSnapshot: Identifiable, Equatable, Sendable {
    var id: TaskListMirror.ID { taskList.id }
    var taskList: TaskListMirror
    var tasks: [TaskMirror]

    static func build(taskLists: [TaskListMirror], tasks: [TaskMirror]) -> [TaskListSectionSnapshot] {
        let visibleTasksByList = Dictionary(grouping: tasks.filter { !$0.isDeleted }) { task in
            task.taskListID
        }

        return taskLists.map { taskList in
            TaskListSectionSnapshot(
                taskList: taskList,
                tasks: visibleTasksByList[taskList.id, default: []]
            )
        }
    }
}

struct CachedAppState: Codable, Sendable {
    var account: GoogleAccount?
    var taskLists: [TaskListMirror]
    var tasks: [TaskMirror]
    var calendars: [CalendarListMirror]
    var events: [CalendarEventMirror]
    var settings: AppSettings
    var syncCheckpoints: [SyncCheckpoint]
    var pendingMutations: [PendingMutation]

    init(
        account: GoogleAccount?,
        taskLists: [TaskListMirror],
        tasks: [TaskMirror],
        calendars: [CalendarListMirror],
        events: [CalendarEventMirror],
        settings: AppSettings,
        syncCheckpoints: [SyncCheckpoint] = [],
        pendingMutations: [PendingMutation] = []
    ) {
        self.account = account
        self.taskLists = taskLists
        self.tasks = tasks
        self.calendars = calendars
        self.events = events
        self.settings = settings
        self.syncCheckpoints = syncCheckpoints
        self.pendingMutations = pendingMutations
    }

    enum CodingKeys: String, CodingKey {
        case account
        case taskLists
        case tasks
        case calendars
        case events
        case settings
        case syncCheckpoints
        case pendingMutations
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        account = try container.decodeIfPresent(GoogleAccount.self, forKey: .account)
        taskLists = try container.decodeIfPresent([TaskListMirror].self, forKey: .taskLists) ?? []
        tasks = try container.decodeIfPresent([TaskMirror].self, forKey: .tasks) ?? []
        calendars = try container.decodeIfPresent([CalendarListMirror].self, forKey: .calendars) ?? []
        events = try container.decodeIfPresent([CalendarEventMirror].self, forKey: .events) ?? []
        settings = try container.decodeIfPresent(AppSettings.self, forKey: .settings) ?? .default
        syncCheckpoints = try container.decodeIfPresent([SyncCheckpoint].self, forKey: .syncCheckpoints) ?? []
        pendingMutations = try container.decodeIfPresent([PendingMutation].self, forKey: .pendingMutations) ?? []
    }

    static let empty = CachedAppState(
        account: nil,
        taskLists: [],
        tasks: [],
        calendars: [],
        events: [],
        settings: .default
    )

    static var preview: CachedAppState {
        let now = Date()
        let calendar = Calendar.current
        let inbox = TaskListMirror(id: "tasks-inbox", title: "Inbox", updatedAt: now, etag: "preview-1")
        let focus = TaskListMirror(id: "tasks-focus", title: "Focused Work", updatedAt: now, etag: "preview-2")
        let primary = CalendarListMirror(
            id: "primary",
            summary: "Personal Calendar",
            colorHex: "#F66B3D",
            isSelected: true,
            accessRole: "owner",
            etag: "calendar-1"
        )
        let planning = CalendarListMirror(
            id: "planning",
            summary: "Deep Work",
            colorHex: "#1677FF",
            isSelected: true,
            accessRole: "owner",
            etag: "calendar-2"
        )

        return CachedAppState(
            account: .preview,
            taskLists: [inbox, focus],
            tasks: [
                TaskMirror(
                    id: "task-1",
                    taskListID: inbox.id,
                    parentID: nil,
                    title: "Draft Google Tasks sync contract",
                    notes: "Keep the app model close to Google Tasks fields.",
                    status: .needsAction,
                    dueDate: now,
                    completedAt: nil,
                    isDeleted: false,
                    isHidden: false,
                    position: "0001",
                    etag: "task-1-etag",
                    updatedAt: now
                ),
                TaskMirror(
                    id: "task-2",
                    taskListID: focus.id,
                    parentID: nil,
                    title: "Map Calendar time blocks",
                    notes: "Time-specific work belongs in Calendar, not Tasks.",
                    status: .needsAction,
                    dueDate: calendar.date(byAdding: .day, value: 1, to: now),
                    completedAt: nil,
                    isDeleted: false,
                    isHidden: false,
                    position: "0002",
                    etag: "task-2-etag",
                    updatedAt: now
                )
            ],
            calendars: [primary, planning],
            events: [
                CalendarEventMirror(
                    id: "event-1",
                    calendarID: planning.id,
                    summary: "Calendar adapter design",
                    details: "Store nextSyncToken per selected calendar.",
                    startDate: calendar.date(bySettingHour: 10, minute: 0, second: 0, of: now) ?? now,
                    endDate: calendar.date(bySettingHour: 11, minute: 0, second: 0, of: now) ?? now,
                    isAllDay: false,
                    status: .confirmed,
                    recurrence: [],
                    etag: "event-1-etag",
                    updatedAt: now
                ),
                CalendarEventMirror(
                    id: "event-2",
                    calendarID: primary.id,
                    summary: "Review DMG distribution path",
                    details: "Developer ID signing and notarization before public downloads.",
                    startDate: calendar.date(bySettingHour: 14, minute: 30, second: 0, of: now) ?? now,
                    endDate: calendar.date(bySettingHour: 15, minute: 0, second: 0, of: now) ?? now,
                    isAllDay: false,
                    status: .confirmed,
                    recurrence: [],
                    etag: "event-2-etag",
                    updatedAt: now
                )
            ],
            settings: AppSettings(
                syncMode: .balanced,
                selectedCalendarIDs: [primary.id, planning.id],
                selectedTaskListIDs: [inbox.id, focus.id],
                enableLocalNotifications: true
            )
        )
    }
}
