import Foundation

actor SyncScheduler {
    // Slack subtracted from the Tasks `updatedMin` watermark when we have to
    // fall back to the local clock (Date header missing or unparseable from
    // Google's response). The preferred path — §14 fix — reads Google's
    // server Date header on each listTasks call and uses that directly, so
    // clock drift between the user's device and Google is irrelevant. The
    // fallback slack handles the rare case where the header isn't available
    // (network quirks, mocks in tests without a Date header set).
    static let tasksWatermarkSlackSeconds: TimeInterval = 300

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
            events: mergeEvents(existing: baseState.events, results: eventResults, retentionDaysBack: settings.eventRetentionDaysBack, now: syncStartedAt),
            settings: settings,
            syncCheckpoints: mergeCheckpoints(
                existing: baseState.syncCheckpoints,
                updated: updatedCheckpoints,
                accountID: accountID
            ),
            pendingMutations: baseState.pendingMutations
        )
    }

    // Concurrency cap for per-resource fan-out (task lists, calendars).
    // Before: one child task per resource, no ceiling. Users with many
    // shared calendars or task lists triggered 15+ parallel HTTP requests,
    // competing for CPU/network and occasionally hitting Google rate
    // limits. 5 is enough to hide latency behind one another without
    // flooding.
    private static let maxConcurrentSyncRequests = 5

    private func listTasks(
        for taskLists: [TaskListMirror],
        accountID: GoogleAccount.ID,
        checkpointIndex: [String: SyncCheckpoint],
        syncStartedAt: Date
    ) async throws -> [TaskListSyncResult] {
        let tasksClient = tasksClient
        return try await withThrowingTaskGroup(of: TaskListSyncResult.self) { group in
            var iter = taskLists.makeIterator()
            // Seed the window with up to `maxConcurrentSyncRequests` children.
            // As each finishes we add one more from the iterator until all are
            // dispatched — keeps in-flight work bounded without losing any
            // resource from the batch.
            var enqueued = 0
            while enqueued < Self.maxConcurrentSyncRequests, let taskList = iter.next() {
                let checkpoint = checkpoint(
                    accountID: accountID,
                    resourceType: .taskList,
                    resourceID: taskList.id,
                    checkpointIndex: checkpointIndex
                )

                group.addTask {
                    let page = try await tasksClient.listTasks(
                        taskListID: taskList.id,
                        updatedMin: checkpoint?.tasksUpdatedMin
                    )
                    // Prefer Google's server Date — no clock-drift exposure.
                    // Fallback path uses local clock minus the slack for the
                    // rare case where the header is absent.
                    let nextWatermark: Date = page.serverDate
                        ?? syncStartedAt.addingTimeInterval(-Self.tasksWatermarkSlackSeconds)
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
                        tasksUpdatedMin: nextWatermark,
                        lastSuccessfulSyncAt: Date()
                    )
                    return TaskListSyncResult(
                        taskListID: taskList.id,
                        tasks: page.tasks,
                        didFullSync: checkpoint?.tasksUpdatedMin == nil,
                        checkpoint: nextCheckpoint
                    )
                }
                enqueued += 1
            }

            var results: [TaskListSyncResult] = []
            for try await result in group {
                results.append(result)
                // Maintain the sliding window: every time a child finishes
                // and we collect its result, add the next pending task list.
                if let nextList = iter.next() {
                    let checkpoint = checkpoint(
                        accountID: accountID,
                        resourceType: .taskList,
                        resourceID: nextList.id,
                        checkpointIndex: checkpointIndex
                    )
                    group.addTask {
                        let page = try await tasksClient.listTasks(
                            taskListID: nextList.id,
                            updatedMin: checkpoint?.tasksUpdatedMin
                        )
                        let nextWatermark: Date = page.serverDate
                            ?? syncStartedAt.addingTimeInterval(-Self.tasksWatermarkSlackSeconds)
                        let nextCheckpoint = SyncCheckpoint(
                            id: SyncCheckpoint.stableID(
                                accountID: accountID,
                                resourceType: .taskList,
                                resourceID: nextList.id
                            ),
                            accountID: accountID,
                            resourceType: .taskList,
                            resourceID: nextList.id,
                            calendarSyncToken: nil,
                            tasksUpdatedMin: nextWatermark,
                            lastSuccessfulSyncAt: Date()
                        )
                        return TaskListSyncResult(
                            taskListID: nextList.id,
                            tasks: page.tasks,
                            didFullSync: checkpoint?.tasksUpdatedMin == nil,
                            checkpoint: nextCheckpoint
                        )
                    }
                }
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
            // Same sliding-window concurrency cap as listTasks.
            let idArray = Array(resolvedIDs)
            var iter = idArray.makeIterator()
            func scheduleNext() {
                guard let calendarID = iter.next() else { return }
                let cp = checkpoint(
                    accountID: accountID,
                    resourceType: .calendar,
                    resourceID: calendarID,
                    checkpointIndex: checkpointIndex
                )
                group.addTask {
                    let hadSyncToken = cp?.calendarSyncToken?.isEmpty == false
                    let page: GoogleCalendarEventsPage
                    let didFullSync: Bool

                    do {
                        page = try await calendarClient.listEvents(
                            calendarID: calendarID,
                            syncToken: cp?.calendarSyncToken,
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
                        calendarSyncToken: page.nextSyncToken ?? cp?.calendarSyncToken,
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

            for _ in 0..<Self.maxConcurrentSyncRequests {
                scheduleNext()
            }

            var results: [CalendarSyncResult] = []
            for try await result in group {
                results.append(result)
                scheduleNext()
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

        for task in existing {
            let isPending = OptimisticID.isPending(task.id)
            let preservedByIncrementalSync = fullSyncTaskListIDs.contains(task.taskListID) == false
            // Optimistic local-ID tasks must survive full syncs — they will never be in the
            // server response until their create mutation lands, and dropping them here leaves
            // the row invisible until the next replay attempt.
            if isPending || preservedByIncrementalSync {
                tasksByID[task.id] = task
            }
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

    private func mergeEvents(
        existing: [CalendarEventMirror],
        results: [CalendarSyncResult],
        retentionDaysBack: Int,
        now: Date
    ) -> [CalendarEventMirror] {
        let fullSyncCalendarIDs = Set(results.filter(\.didFullSync).map(\.calendarID))
        var eventsByID: [CalendarEventMirror.ID: CalendarEventMirror] = [:]

        for event in existing {
            let isPending = OptimisticID.isPending(event.id)
            let preservedByIncrementalSync = fullSyncCalendarIDs.contains(event.calendarID) == false
            if isPending || preservedByIncrementalSync {
                eventsByID[event.id] = event
            }
        }

        for event in results.flatMap(\.events) {
            eventsByID[event.id] = event
        }

        // §7.02: drop events whose endDate is older than the retention window.
        // `retentionDaysBack <= 0` disables pruning (keep-forever). Optimistic
        // writes (pending-id) are ALWAYS kept so a local mutation from earlier
        // today isn't torched before it's confirmed by Google. Same reasoning
        // applies to recently-updated events — ignore the end-in-past rule if
        // the event was mutated on Google within the retention window (via
        // `updatedAt`), because users frequently reopen past meetings to edit
        // notes / action items.
        let cutoff: Date? = {
            guard retentionDaysBack > 0 else { return nil }
            return Calendar.current.date(byAdding: .day, value: -retentionDaysBack, to: now)
        }()

        return eventsByID.values
            .filter { $0.status != .cancelled } // purge cancellations post-merge
            .filter { event in
                guard let cutoff else { return true }
                if OptimisticID.isPending(event.id) { return true }
                if event.endDate >= cutoff { return true }
                if let updatedAt = event.updatedAt, updatedAt >= cutoff { return true }
                return false
            }
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
