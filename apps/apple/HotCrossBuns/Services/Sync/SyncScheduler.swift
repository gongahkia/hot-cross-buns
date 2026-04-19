import Foundation

actor SyncScheduler {
    private let tasksClient: GoogleTasksClient
    private let calendarClient: GoogleCalendarClient

    init(tasksClient: GoogleTasksClient, calendarClient: GoogleCalendarClient) {
        self.tasksClient = tasksClient
        self.calendarClient = calendarClient
    }

    func syncNow(mode: SyncMode, baseState: CachedAppState) async throws -> CachedAppState {
        guard let accountID = baseState.account?.id else {
            return baseState
        }

        let syncStartedAt = Date()
        let checkpointIndex = indexCheckpoints(baseState.syncCheckpoints)
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

        async let loadedTasks = listTasks(
            for: selectedTaskLists,
            accountID: accountID,
            checkpointIndex: checkpointIndex,
            syncStartedAt: syncStartedAt
        )
        async let loadedEvents = listEvents(
            for: calendars,
            selectedCalendarIDs: selectedCalendarIDs,
            accountID: accountID,
            checkpointIndex: checkpointIndex,
            syncStartedAt: syncStartedAt
        )

        let taskResults = try await loadedTasks
        let eventResults = try await loadedEvents
        let updatedCheckpoints = taskResults.map(\.checkpoint) + eventResults.map(\.checkpoint)

        var settings = baseState.settings
        settings.syncMode = mode
        settings.selectedCalendarIDs = selectedCalendarIDs
        settings.selectedTaskListIDs = selectedTaskListIDs
        settings.hasConfiguredCalendarSelection = baseState.settings.hasConfiguredCalendarSelection
            || baseState.settings.selectedCalendarIDs.isEmpty == false
            || selectedCalendarIDs.isEmpty == false
        settings.hasConfiguredTaskListSelection = baseState.settings.hasConfiguredTaskListSelection
            || baseState.settings.selectedTaskListIDs.isEmpty == false
            || selectedTaskListIDs.isEmpty == false

        return CachedAppState(
            account: baseState.account,
            taskLists: taskLists,
            tasks: mergeTasks(existing: baseState.tasks, results: taskResults),
            calendars: calendars.map { calendar in
                var calendar = calendar
                calendar.isSelected = selectedCalendarIDs.contains(calendar.id)
                return calendar
            },
            events: mergeEvents(existing: baseState.events, results: eventResults),
            settings: settings,
            syncCheckpoints: mergeCheckpoints(
                existing: baseState.syncCheckpoints,
                updated: updatedCheckpoints,
                accountID: accountID
            ),
            pendingMutations: baseState.pendingMutations
        )
    }

    private func listTasks(
        for taskLists: [TaskListMirror],
        accountID: GoogleAccount.ID,
        checkpointIndex: [String: SyncCheckpoint],
        syncStartedAt: Date
    ) async throws -> [TaskListSyncResult] {
        let tasksClient = tasksClient
        return try await withThrowingTaskGroup(of: TaskListSyncResult.self) { group in
            for taskList in taskLists {
                let checkpoint = checkpoint(
                    accountID: accountID,
                    resourceType: .taskList,
                    resourceID: taskList.id,
                    checkpointIndex: checkpointIndex
                )

                group.addTask {
                    let tasks = try await tasksClient.listTasks(
                        taskListID: taskList.id,
                        updatedMin: checkpoint?.tasksUpdatedMin
                    )
                    let nextCheckpoint = SyncCheckpoint(
                        id: SyncCheckpoint.stableID(
                            accountID: accountID,
                            resourceType: .taskList,
                            resourceID: taskList.id
                        ),
                        accountID: accountID,
                        resourceType: .taskList,
                        resourceID: taskList.id,
                        calendarSyncToken: nil,
                        tasksUpdatedMin: syncStartedAt.addingTimeInterval(-60),
                        lastSuccessfulSyncAt: Date()
                    )
                    return TaskListSyncResult(
                        taskListID: taskList.id,
                        tasks: tasks,
                        didFullSync: checkpoint?.tasksUpdatedMin == nil,
                        checkpoint: nextCheckpoint
                    )
                }
            }

            var results: [TaskListSyncResult] = []
            for try await result in group {
                results.append(result)
            }
            return results
        }
    }

    private func listEvents(
        for calendars: [CalendarListMirror],
        selectedCalendarIDs: Set<CalendarListMirror.ID>,
        accountID: GoogleAccount.ID,
        checkpointIndex: [String: SyncCheckpoint],
        syncStartedAt: Date
    ) async throws -> [CalendarSyncResult] {
        let resolvedIDs = selectedCalendarIDs.isEmpty
            ? Set(calendars.filter(\.isSelected).map(\.id))
            : selectedCalendarIDs
        let startOfToday = Calendar.current.startOfDay(for: Date())
        let calendarClient = calendarClient

        return try await withThrowingTaskGroup(of: CalendarSyncResult.self) { group in
            for calendarID in resolvedIDs {
                let checkpoint = checkpoint(
                    accountID: accountID,
                    resourceType: .calendar,
                    resourceID: calendarID,
                    checkpointIndex: checkpointIndex
                )

                group.addTask {
                    let hadSyncToken = checkpoint?.calendarSyncToken?.isEmpty == false
                    let page: GoogleCalendarEventsPage
                    let didFullSync: Bool

                    do {
                        page = try await calendarClient.listEvents(
                            calendarID: calendarID,
                            syncToken: checkpoint?.calendarSyncToken,
                            timeMin: startOfToday
                        )
                        didFullSync = hadSyncToken == false
                    } catch GoogleAPIError.httpStatus(410, _) {
                        page = try await calendarClient.listEvents(
                            calendarID: calendarID,
                            syncToken: nil,
                            timeMin: startOfToday
                        )
                        didFullSync = true
                    }

                    let nextCheckpoint = SyncCheckpoint(
                        id: SyncCheckpoint.stableID(
                            accountID: accountID,
                            resourceType: .calendar,
                            resourceID: calendarID
                        ),
                        accountID: accountID,
                        resourceType: .calendar,
                        resourceID: calendarID,
                        calendarSyncToken: page.nextSyncToken ?? checkpoint?.calendarSyncToken,
                        tasksUpdatedMin: nil,
                        lastSuccessfulSyncAt: syncStartedAt
                    )
                    return CalendarSyncResult(
                        calendarID: calendarID,
                        events: page.events,
                        didFullSync: didFullSync,
                        checkpoint: nextCheckpoint
                    )
                }
            }

            var results: [CalendarSyncResult] = []
            for try await result in group {
                results.append(result)
            }
            return results
        }
    }

    private func resolvedSelectedCalendarIDs(
        calendars: [CalendarListMirror],
        settings: AppSettings
    ) -> Set<CalendarListMirror.ID> {
        let availableIDs = Set(calendars.map(\.id))
        let requestedIDs = settings.selectedCalendarIDs.intersection(availableIDs)

        if settings.hasConfiguredCalendarSelection {
            return requestedIDs
        }

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

        if settings.hasConfiguredTaskListSelection {
            return requestedIDs
        }

        return requestedIDs.isEmpty ? availableIDs : requestedIDs
    }

    private func checkpoint(
        accountID: GoogleAccount.ID,
        resourceType: SyncResourceType,
        resourceID: String,
        checkpointIndex: [String: SyncCheckpoint]
    ) -> SyncCheckpoint? {
        checkpointIndex[SyncCheckpoint.stableID(
            accountID: accountID,
            resourceType: resourceType,
            resourceID: resourceID
        )]
    }

    private func indexCheckpoints(_ checkpoints: [SyncCheckpoint]) -> [SyncCheckpoint.ID: SyncCheckpoint] {
        var checkpointsByID: [SyncCheckpoint.ID: SyncCheckpoint] = [:]

        for checkpoint in checkpoints {
            checkpointsByID[checkpoint.id] = checkpoint
        }

        return checkpointsByID
    }

    private func mergeTasks(existing: [TaskMirror], results: [TaskListSyncResult]) -> [TaskMirror] {
        let fullSyncTaskListIDs = Set(results.filter(\.didFullSync).map(\.taskListID))
        var tasksByID: [TaskMirror.ID: TaskMirror] = [:]

        for task in existing where fullSyncTaskListIDs.contains(task.taskListID) == false {
            tasksByID[task.id] = task
        }

        for task in results.flatMap(\.tasks) {
            tasksByID[task.id] = task
        }

        return tasksByID.values
            .filter { $0.isDeleted == false } // purge tombstones post-merge
            .sorted { lhs, rhs in
                (lhs.dueDate ?? lhs.updatedAt ?? .distantFuture) < (rhs.dueDate ?? rhs.updatedAt ?? .distantFuture)
            }
    }

    private func mergeEvents(existing: [CalendarEventMirror], results: [CalendarSyncResult]) -> [CalendarEventMirror] {
        let fullSyncCalendarIDs = Set(results.filter(\.didFullSync).map(\.calendarID))
        var eventsByID: [CalendarEventMirror.ID: CalendarEventMirror] = [:]

        for event in existing where fullSyncCalendarIDs.contains(event.calendarID) == false {
            eventsByID[event.id] = event
        }

        for event in results.flatMap(\.events) {
            eventsByID[event.id] = event
        }

        return eventsByID.values
            .filter { $0.status != .cancelled } // purge cancellations post-merge
            .sorted { lhs, rhs in
                lhs.startDate < rhs.startDate
            }
    }

    private func mergeCheckpoints(
        existing: [SyncCheckpoint],
        updated: [SyncCheckpoint],
        accountID: GoogleAccount.ID
    ) -> [SyncCheckpoint] {
        var checkpointsByID: [SyncCheckpoint.ID: SyncCheckpoint] = [:]

        for checkpoint in existing where checkpoint.accountID == accountID {
            checkpointsByID[checkpoint.id] = checkpoint
        }

        for checkpoint in updated {
            checkpointsByID[checkpoint.id] = checkpoint
        }

        return checkpointsByID.values.sorted { $0.id < $1.id }
    }
}

private struct TaskListSyncResult: Sendable {
    var taskListID: TaskListMirror.ID
    var tasks: [TaskMirror]
    var didFullSync: Bool
    var checkpoint: SyncCheckpoint
}

private struct CalendarSyncResult: Sendable {
    var calendarID: CalendarListMirror.ID
    var events: [CalendarEventMirror]
    var didFullSync: Bool
    var checkpoint: SyncCheckpoint
}
