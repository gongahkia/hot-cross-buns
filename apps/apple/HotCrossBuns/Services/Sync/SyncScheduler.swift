import Foundation

actor SyncScheduler {
    private let tasksClient: GoogleTasksClient
    private let calendarClient: GoogleCalendarClient

    init(tasksClient: GoogleTasksClient, calendarClient: GoogleCalendarClient) {
        self.tasksClient = tasksClient
        self.calendarClient = calendarClient
    }

    func syncNow(mode: SyncMode, baseState: CachedAppState) async throws -> CachedAppState {
        let taskLists = try await tasksClient.listTaskLists()
        let calendars = try await calendarClient.listCalendars()
        let selectedCalendarIDs = resolvedSelectedCalendarIDs(
            calendars: calendars,
            settings: baseState.settings
        )
        let selectedTaskListIDs = resolvedSelectedTaskListIDs(
            taskLists: taskLists,
            settings: baseState.settings
        )
        let selectedTaskLists = taskLists.filter { selectedTaskListIDs.contains($0.id) }

        async let loadedTasks = listTasks(for: selectedTaskLists)
        async let loadedEvents = listEvents(for: calendars, selectedCalendarIDs: selectedCalendarIDs)

        let tasks = try await loadedTasks
        let events = try await loadedEvents

        return CachedAppState(
            account: baseState.account,
            taskLists: taskLists,
            tasks: tasks,
            calendars: calendars.map { calendar in
                var calendar = calendar
                calendar.isSelected = selectedCalendarIDs.contains(calendar.id)
                return calendar
            },
            events: events,
            settings: AppSettings(
                syncMode: mode,
                selectedCalendarIDs: selectedCalendarIDs,
                selectedTaskListIDs: selectedTaskListIDs,
                enableLocalNotifications: baseState.settings.enableLocalNotifications
            )
        )
    }

    private func listTasks(for taskLists: [TaskListMirror]) async throws -> [TaskMirror] {
        let tasksClient = tasksClient
        return try await withThrowingTaskGroup(of: [TaskMirror].self) { group in
            for taskList in taskLists {
                group.addTask {
                    try await tasksClient.listTasks(taskListID: taskList.id, updatedMin: nil)
                }
            }

            var tasks: [TaskMirror] = []
            for try await batch in group {
                tasks.append(contentsOf: batch)
            }
            return tasks
        }
    }

    private func listEvents(
        for calendars: [CalendarListMirror],
        selectedCalendarIDs: Set<CalendarListMirror.ID>
    ) async throws -> [CalendarEventMirror] {
        let resolvedIDs = selectedCalendarIDs.isEmpty
            ? Set(calendars.filter(\.isSelected).map(\.id))
            : selectedCalendarIDs
        let startOfToday = Calendar.current.startOfDay(for: Date())
        let calendarClient = calendarClient

        return try await withThrowingTaskGroup(of: [CalendarEventMirror].self) { group in
            for calendarID in resolvedIDs {
                group.addTask {
                    try await calendarClient
                        .listEvents(calendarID: calendarID, syncToken: nil, timeMin: startOfToday)
                        .events
                }
            }

            var events: [CalendarEventMirror] = []
            for try await batch in group {
                events.append(contentsOf: batch)
            }
            return events
        }
    }

    private func resolvedSelectedCalendarIDs(
        calendars: [CalendarListMirror],
        settings: AppSettings
    ) -> Set<CalendarListMirror.ID> {
        let availableIDs = Set(calendars.map(\.id))
        let requestedIDs = settings.selectedCalendarIDs.intersection(availableIDs)

        if requestedIDs.isEmpty == false {
            return requestedIDs
        }

        return Set(calendars.filter(\.isSelected).map(\.id))
    }

    private func resolvedSelectedTaskListIDs(
        taskLists: [TaskListMirror],
        settings: AppSettings
    ) -> Set<TaskListMirror.ID> {
        let availableIDs = Set(taskLists.map(\.id))
        let requestedIDs = settings.selectedTaskListIDs.intersection(availableIDs)
        return requestedIDs.isEmpty ? availableIDs : requestedIDs
    }
}
