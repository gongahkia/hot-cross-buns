import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    private let authService: GoogleAuthService
    private let tasksClient: GoogleTasksClient
    private let calendarClient: GoogleCalendarClient
    private let syncScheduler: SyncScheduler
    private let cacheStore: LocalCacheStore
    private let notificationScheduler: LocalNotificationScheduler
    private let spotlightIndexer: SpotlightIndexer

    private(set) var account: GoogleAccount?
    private(set) var authState: AuthState = .signedOut
    private(set) var syncState: SyncState = .idle
    // Reference-counted so overlapping mutations (e.g. TaskInspectorView's
    // detached commit-on-close race with a simultaneous completion toggle
    // elsewhere) don't prematurely flip isMutating to false and let
    // refreshNow start syncing while another mutation's still in flight.
    private var mutationCount: Int = 0
    var isMutating: Bool { mutationCount > 0 }
    private var isReplayingMutations: Bool = false
    // Set by the near-real-time loop when it has exhausted its retry
    // budget against transient failures; cleared on a successful refresh or
    // a manual resume (scene activation, user tap).
    private(set) var isSyncPaused: Bool = false
    // Set when the Share Extension (or a future Services-menu / drag
    // handler) queues text for the main app. QuickAddView reads this
    // on appear, prefills its title field, then clears it.
    var pendingSharedPrefill: String?
    // Populated by HCBDeepLinkRouter when a hotcrossbuns:// URL routes to
    // new/task. The AddTaskSheet reads these on appear, populates its fields,
    // then clears to nil. Deep links never auto-submit — the user always
    // confirms the prefilled sheet before any Google write.
    var pendingTaskPrefill: DeepLinkTaskPrefill?
    var pendingEventPrefill: DeepLinkEventPrefill?
    // Query pre-populated into the command palette when a search deep link fires.
    var pendingPaletteQuery: String?
    // Store filter the quick switcher asks the Store to apply on appear.
    // Store clears it once consumed so a subsequent tab switch doesn't reapply.
    var pendingStoreFilterKey: String?
    // Populated on first launch-time check; DiagnosticsView surfaces.
    private(set) var keychainHealth: KeychainHealth = .unknown
    private(set) var lastMutationError: String?
    private(set) var taskLists: [TaskListMirror] = []
    private(set) var tasks: [TaskMirror] = []
    private(set) var calendars: [CalendarListMirror] = []
    private(set) var events: [CalendarEventMirror] = []
    private(set) var taskSections: [TaskListSectionSnapshot] = []
    private(set) var todaySnapshot: TodaySnapshot = .empty
    private(set) var calendarSnapshot: CalendarSnapshot = .empty
    // Cached during rebuildSnapshots so the sidebar badge doesn't have to
    // re-filter the full tasks array on every sidebar render.
    private(set) var openTaskCountForSidebar: Int = 0
    // Per-list completion stats for Store section headers — avoids O(n)
    // filtering per list on every header render.
    private(set) var taskListCompletionStats: [TaskListMirror.ID: TaskListCompletionStats] = [:]
    private(set) var syncCheckpoints: [SyncCheckpoint] = []
    private(set) var pendingMutations: [PendingMutation] = []
    private(set) var recentlyCompletedTaskID: TaskMirror.ID?
    private(set) var undoable: UndoableAction?
    private var undoActionID = UUID()
    var undoActionToken: UUID { undoActionID }
    var settings: AppSettings

    var lastSuccessfulSyncAt: Date? {
        syncCheckpoints.compactMap(\.lastSuccessfulSyncAt).max()
    }

    init(
        authService: GoogleAuthService,
        tasksClient: GoogleTasksClient,
        calendarClient: GoogleCalendarClient,
        syncScheduler: SyncScheduler,
        cacheStore: LocalCacheStore,
        notificationScheduler: LocalNotificationScheduler = LocalNotificationScheduler(),
        spotlightIndexer: SpotlightIndexer = SpotlightIndexer(),
        settings: AppSettings = .default
    ) {
        self.authService = authService
        self.tasksClient = tasksClient
        self.calendarClient = calendarClient
        self.syncScheduler = syncScheduler
        self.cacheStore = cacheStore
        self.notificationScheduler = notificationScheduler
        self.spotlightIndexer = spotlightIndexer
        self.settings = settings
    }

    static func bootstrap() -> AppModel {
        let tokenProvider = GoogleSignInAccessTokenProvider()
        let transport = GoogleAPITransport(
            baseURL: URL(string: "https://www.googleapis.com")!,
            tokenProvider: tokenProvider
        )

        let tasksClient = GoogleTasksClient(transport: transport)
        let calendarClient = GoogleCalendarClient(transport: transport)
        return AppModel(
            authService: GoogleAuthService(),
            tasksClient: tasksClient,
            calendarClient: calendarClient,
            syncScheduler: SyncScheduler(
                tasksClient: tasksClient,
                calendarClient: calendarClient
            ),
            cacheStore: LocalCacheStore(),
            notificationScheduler: LocalNotificationScheduler()
        )
    }

    static var preview: AppModel {
        let model = AppModel.bootstrap()
        model.installPreviewData()
        return model
    }

    func loadInitialState() async {
        // Probe Keychain before anything that would touch GIDSignIn. If
        // the Keychain is locked/denied the restore will fail generically;
        // the probe lets us surface a specific reason in Diagnostics.
        keychainHealth = KeychainProbe.run()
        if keychainHealth == .denied {
            AppLogger.warn("keychain inaccessible at launch", category: .auth)
        }
        let cachedState = await cacheStore.loadCachedState()
        apply(cachedState)
        authState = cachedState.account.map(AuthState.signedIn) ?? .signedOut
        if let warning = await cacheStore.lastLoadWarning {
            lastMutationError = warning
        }
        await synchronizeLocalNotifications()
    }

    func restoreGoogleSession() async {
        do {
            guard let restoredAccount = try await authService.restorePreviousSignIn() else {
                account = nil
                authState = .signedOut
                return
            }

            account = restoredAccount
            authState = .signedIn(restoredAccount)
        } catch {
            authState = .failed(error.localizedDescription)
        }
    }

    func connectGoogleAccount() async {
        authState = .authenticating
        do {
            let account = try await authService.signIn()
            self.account = account
            authState = .signedIn(account)
            syncState = .idle
            await saveCurrentState()
        } catch {
            authState = .failed(error.localizedDescription)
        }
    }

    func disconnectGoogleAccount() async {
        do {
            try await authService.disconnect()
        } catch {
            authService.signOut()
        }

        account = nil
        authState = .signedOut
        syncState = .idle
        await saveCurrentState()
        await spotlightIndexer.removeAll()
    }

    func handleAuthRedirect(_ url: URL) {
        _ = authService.handleRedirectURL(url)
    }

    func refreshForCurrentSyncMode() async {
        guard settings.syncMode != .manual else {
            return
        }

        await refreshNow()
    }

    enum RefreshOutcome: Sendable {
        case skipped
        case succeeded
        case failed(Error)
    }

    @discardableResult
    func refreshNow() async -> RefreshOutcome {
        if case .syncing = syncState {
            return .skipped
        }

        if isMutating {
            AppLogger.debug("refresh skipped: mutation in flight", category: .sync)
            return .skipped // defer refresh until mutation settles to avoid state races
        }

        guard account != nil else {
            AppLogger.warn("refresh skipped: no account", category: .sync)
            syncState = .failed(message: "Connect Google before syncing.")
            return .skipped
        }

        let started = Date()
        AppLogger.info("refresh start", category: .sync, metadata: ["mode": settings.syncMode.rawValue])
        syncState = .syncing(startedAt: started)
        await replayPendingMutations()
        do {
            let syncedState = try await syncScheduler.syncNow(
                mode: settings.syncMode,
                baseState: currentCachedState()
            )
            apply(syncedState)
            authState = syncedState.account.map(AuthState.signedIn) ?? .signedOut
            syncState = .synced(at: Date())
            isSyncPaused = false
            await saveCurrentState()
            await synchronizeLocalNotifications()
            let duration = Int(Date().timeIntervalSince(started) * 1000)
            AppLogger.info("refresh succeeded", category: .sync, metadata: [
                "ms": String(duration),
                "tasks": String(tasks.count),
                "events": String(events.count)
            ])
            return .succeeded
        } catch {
            var httpStatus: String? = nil
            if case let GoogleAPIError.httpStatus(status, _) = error {
                httpStatus = String(status)
                if status == 401 || status == 403 {
                    authState = .failed(error.localizedDescription)
                }
            }
            if let tokenError = error as? GoogleTokenRefreshError, tokenError.requiresReconnect {
                authState = .failed(tokenError.localizedDescription ?? "Reconnect Google to continue.")
            }
            var meta: [String: String] = ["error": String(describing: error)]
            if let httpStatus { meta["status"] = httpStatus }
            AppLogger.error("refresh failed", category: .sync, metadata: meta)
            syncState = .failed(message: error.localizedDescription)
            return .failed(error)
        }
    }

    func createTask(
        title: String,
        notes: String,
        dueDate: Date?,
        taskListID: TaskListMirror.ID,
        parentID: TaskMirror.ID? = nil
    ) async -> Bool {
        guard requireAccount(mutationDescription: "creating tasks") else {
            return false
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let localID = OptimisticID.generate()

        let optimisticTask = TaskMirror(
            id: localID,
            taskListID: taskListID,
            parentID: parentID,
            title: trimmedTitle,
            notes: trimmedNotes,
            status: .needsAction,
            dueDate: dueDate,
            completedAt: nil,
            isDeleted: false,
            isHidden: false,
            position: nil,
            etag: nil,
            updatedAt: Date()
        )
        upsert(optimisticTask)

        do {
            let payload = PendingTaskCreatePayload(
                localID: localID,
                taskListID: taskListID,
                title: trimmedTitle,
                notes: trimmedNotes,
                dueDate: dueDate,
                parentID: parentID.flatMap { OptimisticID.isPending($0) ? nil : $0 }
            )
            let mutation = try PendingMutation.taskCreate(payload: payload)
            pendingMutations.append(mutation)
            await saveCurrentState()
        } catch {
            removeTask(id: localID)
            lastMutationError = "Could not queue task for sync: \(error.localizedDescription)"
            return false
        }

        Task { await replayPendingMutations() }
        return true
    }

    func duplicateTask(_ task: TaskMirror) async -> Bool {
        await createTask(
            title: task.title,
            notes: task.notes,
            dueDate: task.dueDate,
            taskListID: task.taskListID,
            parentID: task.parentID
        )
    }

    func duplicateEvent(_ event: CalendarEventMirror) async -> Bool {
        await duplicateEvent(event, offsetDays: 0)
    }

    // Shift start/end by offsetDays when duplicating so repeating monthly-ish
    // events that don't fit an RRULE can be cloned forward quickly.
    func duplicateEvent(_ event: CalendarEventMirror, offsetDays: Int) async -> Bool {
        let calendar = Calendar.current
        let shiftedStart = calendar.date(byAdding: .day, value: offsetDays, to: event.startDate) ?? event.startDate
        let shiftedEnd = calendar.date(byAdding: .day, value: offsetDays, to: event.endDate) ?? event.endDate
        return await createEvent(
            summary: event.summary,
            details: event.details,
            startDate: shiftedStart,
            endDate: shiftedEnd,
            isAllDay: event.isAllDay,
            reminderMinutes: event.reminderMinutes.first,
            calendarID: event.calendarID,
            location: event.location
        )
    }

    func moveTaskToList(_ task: TaskMirror, toTaskListID: TaskListMirror.ID) async -> Bool {
        guard task.taskListID != toTaskListID else { return true }
        guard requireAccount(mutationDescription: "moving tasks") else { return false }
        guard requirePersisted(task.id) else { return false }

        beginMutation()
        // Track the inserted destination task separately so we can compensate
        // if a later step fails. Without this, a failure after insertTask
        // leaves the task duplicated on Google — present in both source and
        // destination lists until the user notices and deletes one manually.
        var insertedForCompensation: TaskMirror?
        do {
            let inserted = try await tasksClient.insertTask(
                taskListID: toTaskListID,
                title: task.title,
                notes: task.notes,
                dueDate: task.dueDate,
                parent: nil
            )
            insertedForCompensation = inserted
            let wasCompleted = task.isCompleted
            var finalTask = inserted
            if wasCompleted {
                finalTask = try await tasksClient.setTaskCompleted(true, task: inserted)
                insertedForCompensation = finalTask
            }
            try await tasksClient.deleteTask(
                taskListID: task.taskListID,
                taskID: task.id,
                ifMatch: task.etag
            )
            removeTask(id: task.id)
            upsert(finalTask)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            // Best-effort rollback of the destination task. If the
            // compensating delete itself fails, log it via lastMutationError
            // but keep the original failure as the primary message so the
            // user knows what actually went wrong first.
            if let orphan = insertedForCompensation {
                do {
                    try await tasksClient.deleteTask(
                        taskListID: orphan.taskListID,
                        taskID: orphan.id,
                        ifMatch: orphan.etag
                    )
                } catch {
                    lastMutationError = "Move failed and the duplicate on the destination list could not be cleaned up. Please remove it manually."
                    endMutation(error: nil)
                    return false
                }
            }
            endMutation(error: error)
            return false
        }
    }

    func indentTask(_ task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "indenting tasks") else { return false }
        guard requirePersisted(task.id) else { return false }
        guard TaskHierarchy.canIndent(task, within: tasks) else {
            lastMutationError = "This task can't be indented."
            return false
        }
        guard let sibling = TaskHierarchy.precedingSibling(of: task, in: tasks) else {
            lastMutationError = "Indent needs a task above it in the same list."
            return false
        }

        beginMutation()
        do {
            let moved = try await tasksClient.moveTask(
                taskListID: task.taskListID,
                taskID: task.id,
                parent: sibling.id,
                previous: nil
            )
            upsert(moved)
            endMutation(error: nil)
            await saveCurrentState()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    // Reorders `task` so that it sits immediately after `previousSiblingID`
    // (or at the top of its parent when previousSiblingID is nil). Used by
    // the subtask drag-reorder UI.
    func reorderTask(_ task: TaskMirror, afterSiblingID previousSiblingID: TaskMirror.ID?) async -> Bool {
        guard requireAccount(mutationDescription: "reordering tasks") else { return false }
        guard requirePersisted(task.id) else { return false }
        if let previousSiblingID, previousSiblingID == task.id { return false }

        beginMutation()
        do {
            let moved = try await tasksClient.moveTask(
                taskListID: task.taskListID,
                taskID: task.id,
                parent: task.parentID,
                previous: previousSiblingID
            )
            upsert(moved)
            endMutation(error: nil)
            await saveCurrentState()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    func outdentTask(_ task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "outdenting tasks") else { return false }
        guard requirePersisted(task.id) else { return false }
        guard TaskHierarchy.canOutdent(task) else {
            lastMutationError = "This task isn't nested."
            return false
        }

        beginMutation()
        do {
            let moved = try await tasksClient.moveTask(
                taskListID: task.taskListID,
                taskID: task.id,
                parent: nil,
                previous: task.parentID
            )
            upsert(moved)
            endMutation(error: nil)
            await saveCurrentState()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    func createTaskList(title: String) async -> Bool {
        guard requireAccount(mutationDescription: "creating task lists") else {
            return false
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            lastMutationError = "Give the task list a name before saving."
            return false
        }

        beginMutation()
        do {
            let taskList = try await tasksClient.insertTaskList(title: trimmedTitle)
            upsert(taskList)

            if settings.hasConfiguredTaskListSelection {
                settings.selectedTaskListIDs.insert(taskList.id)
            }

            endMutation(error: nil)
            await saveCurrentState()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    func updateTaskList(_ taskList: TaskListMirror, title: String) async -> Bool {
        guard requireAccount(mutationDescription: "updating task lists") else {
            return false
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            lastMutationError = "Give the task list a name before saving."
            return false
        }

        beginMutation()
        do {
            let updatedTaskList = try await tasksClient.updateTaskList(
                taskListID: taskList.id,
                title: trimmedTitle
            )
            upsert(updatedTaskList)
            endMutation(error: nil)
            await saveCurrentState()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    @discardableResult
    func clearCompletedTasks(in taskListID: TaskListMirror.ID) async -> Int {
        guard requireAccount(mutationDescription: "clearing completed tasks") else { return 0 }
        // Drain any pending delete/completion mutations targeting this list
        // first so the batch clear doesn't race with them — otherwise a
        // queued delete can replay against a task Google has already
        // hidden via clear and 404 with a confusing lastMutationError.
        await replayPendingMutations()
        beginMutation()
        do {
            try await tasksClient.clearCompletedTasks(taskListID: taskListID)
            // Google's clear hides completed tasks server-side. Mirror locally
            // so the UI reflects it immediately — server sync will confirm on
            // the next refresh.
            let affected = tasks.filter { $0.taskListID == taskListID && $0.isCompleted }
            for task in affected {
                removeTask(id: task.id)
            }
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return affected.count
        } catch {
            endMutation(error: error)
            return 0
        }
    }

    func deleteTaskList(_ taskList: TaskListMirror) async -> Bool {
        guard requireAccount(mutationDescription: "deleting task lists") else {
            return false
        }

        beginMutation()
        do {
            try await tasksClient.deleteTaskList(taskListID: taskList.id)
            removeTaskList(id: taskList.id)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    func updateTask(
        _ task: TaskMirror,
        title: String,
        notes: String,
        dueDate: Date?
    ) async -> Bool {
        guard requireAccount(mutationDescription: "updating tasks") else {
            return false
        }
        guard requirePersisted(task.id) else { return false }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            lastMutationError = "Give the task a title before saving."
            return false
        }

        let originalTask = task
        var optimistic = task
        optimistic.title = trimmedTitle
        optimistic.notes = trimmedNotes
        optimistic.dueDate = dueDate
        upsert(optimistic)

        beginMutation()
        do {
            let updatedTask = try await tasksClient.updateTask(
                taskListID: task.taskListID,
                taskID: task.id,
                title: trimmedTitle,
                notes: trimmedNotes,
                dueDate: dueDate,
                ifMatch: task.etag
            )
            upsert(updatedTask)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            recordUndo(.taskEdit(priorSnapshot: originalTask))
            return true
        } catch let error as GoogleAPIError where error.isTransient {
            let payload = PendingTaskUpdatePayload(
                taskListID: task.taskListID,
                taskID: task.id,
                title: trimmedTitle,
                notes: trimmedNotes,
                dueDate: dueDate,
                etagSnapshot: task.etag
            )
            if let mutation = try? PendingMutation.taskUpdate(payload: payload) {
                pendingMutations.append(mutation)
                await saveCurrentState()
                await synchronizeLocalNotifications()
                endMutation(error: nil)
                Task { await replayPendingMutations() }
                return true
            }
            upsert(originalTask)
            endMutation(error: error)
            return false
        } catch {
            upsert(originalTask)
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    func toggleTaskStar(_ task: TaskMirror) async -> Bool {
        let newTitle = TaskStarring.toggledTitle(for: task)
        return await updateTask(task, title: newTitle, notes: task.notes, dueDate: task.dueDate)
    }

    func setTaskCompleted(_ isCompleted: Bool, task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "updating tasks") else {
            return false
        }
        guard requirePersisted(task.id) else { return false }

        // Optimistic local update so the UI flips immediately. Snapshot the
        // prior state so we can revert on terminal failure.
        let originalTask = task
        var optimistic = task
        optimistic.status = isCompleted ? .completed : .needsAction
        optimistic.completedAt = isCompleted ? Date() : nil
        upsert(optimistic)

        beginMutation()
        do {
            let updatedTask = try await tasksClient.setTaskCompleted(isCompleted, task: task)
            upsert(updatedTask)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            if isCompleted {
                recentlyCompletedTaskID = updatedTask.id
                await scheduleNextRecurrenceIfNeeded(for: updatedTask)
            } else if recentlyCompletedTaskID == updatedTask.id {
                recentlyCompletedTaskID = nil
            }
            recordUndo(.taskCompletion(
                taskID: updatedTask.id,
                priorCompleted: originalTask.isCompleted,
                title: updatedTask.title
            ))
            return true
        } catch let error as GoogleAPIError where error.isTransient {
            // Network blip / rate limit / server error — keep the optimistic
            // state and let the replay loop retry this against Google.
            let payload = PendingTaskCompletionPayload(
                taskListID: task.taskListID,
                taskID: task.id,
                isCompleted: isCompleted,
                etagSnapshot: task.etag
            )
            if let mutation = try? PendingMutation.taskCompletion(payload: payload) {
                pendingMutations.append(mutation)
                await saveCurrentState()
                await synchronizeLocalNotifications()
                endMutation(error: nil)
                Task { await replayPendingMutations() }
                return true
            }
            upsert(originalTask)
            endMutation(error: error)
            return false
        } catch {
            upsert(originalTask)
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    private func scheduleNextRecurrenceIfNeeded(for completedTask: TaskMirror) async {
        guard let rule = TaskRecurrenceMarkers.rule(from: completedTask.notes) else { return }
        guard let currentDue = completedTask.dueDate else { return }
        guard let nextDue = rule.advance(currentDue) else { return }
        _ = await createTask(
            title: completedTask.title,
            notes: completedTask.notes,
            dueDate: nextDue,
            taskListID: completedTask.taskListID,
            parentID: completedTask.parentID
        )
    }

    func clearRecentCompletion() {
        recentlyCompletedTaskID = nil
    }

    func undoRecentCompletion() async {
        guard let id = recentlyCompletedTaskID, let task = task(id: id) else { return }
        recentlyCompletedTaskID = nil
        _ = await setTaskCompleted(false, task: task)
    }

    // MARK: Generic undo

    private func recordUndo(_ action: UndoableAction) {
        undoable = action
        undoActionID = UUID()
        // Record a permanent audit entry in parallel — the undo window
        // is short (~6s) but the audit log is a forever record of what
        // the user did, useful when reconstructing "when did I mark
        // that task done?" months later.
        let (kind, resourceID, summary, metadata) = Self.auditTuple(for: action)
        Task { await MutationAuditLog.shared.record(kind: kind, resourceID: resourceID, summary: summary, metadata: metadata) }
    }

    private static func auditTuple(for action: UndoableAction) -> (String, String, String, [String: String]) {
        switch action {
        case .taskCompletion(let id, let prior, let title):
            return (
                prior ? "task.reopen" : "task.complete",
                id,
                title,
                ["priorCompleted": String(prior)]
            )
        case .taskDelete(let snap):
            return ("task.delete", snap.id, snap.title, ["list": snap.taskListID])
        case .taskEdit(let prior):
            return ("task.edit", prior.id, prior.title, ["list": prior.taskListID])
        case .eventDelete(let snap):
            return ("event.delete", snap.id, snap.summary, ["calendar": snap.calendarID])
        case .eventEdit(let prior):
            return ("event.edit", prior.id, prior.summary, ["calendar": prior.calendarID])
        }
    }

    func clearUndo() {
        undoable = nil
    }

    func markSyncPaused() {
        isSyncPaused = true
    }

    func resumeSync() {
        isSyncPaused = false
    }

    // Drains the App Group's shared inbox (populated by the Share
    // Extension) and stashes the concatenated text for QuickAdd to
    // prefill. Returns true if anything was picked up so the caller
    // can decide whether to present the QuickAdd sheet.
    @discardableResult
    func consumePendingSharedItems() -> Bool {
        let items = SharedInboxDefaults.consumeAll()
        guard items.isEmpty == false else { return false }
        pendingSharedPrefill = items
            .map(\.text)
            .joined(separator: "\n")
        return true
    }

    // Drops a single PendingMutation by id so the user can unstick a
    // replay loop that keeps 412'ing (e.g. Google rejected a queued edit
    // because the item was changed elsewhere). Called from DiagnosticsView.
    @discardableResult
    func clearPendingMutation(id: PendingMutation.ID) -> Bool {
        guard pendingMutations.contains(where: { $0.id == id }) else { return false }
        pendingMutations.removeAll { $0.id == id }
        Task { await saveCurrentState() }
        return true
    }

    func clearAllPendingMutations() {
        guard pendingMutations.isEmpty == false else { return }
        pendingMutations = []
        Task { await saveCurrentState() }
    }

    func performUndo() async {
        guard let action = undoable else { return }
        undoable = nil
        switch action {
        case .taskCompletion(let id, let prior, _):
            guard let task = task(id: id) else { return }
            _ = await setTaskCompleted(prior, task: task)
        case .taskDelete(let snap):
            _ = await createTask(
                title: snap.title,
                notes: snap.notes,
                dueDate: snap.dueDate,
                taskListID: snap.taskListID,
                parentID: snap.parentID
            )
        case .taskEdit(let priorSnap):
            guard let task = task(id: priorSnap.id) else { return }
            _ = await updateTask(
                task,
                title: priorSnap.title,
                notes: priorSnap.notes,
                dueDate: priorSnap.dueDate
            )
        case .eventDelete(let snap):
            _ = await createEvent(
                summary: snap.summary,
                details: snap.details,
                startDate: snap.startDate,
                endDate: snap.endDate,
                isAllDay: snap.isAllDay,
                reminderMinutes: snap.reminderMinutes.first,
                calendarID: snap.calendarID,
                location: snap.location,
                recurrence: snap.recurrence,
                attendeeEmails: snap.attendeeEmails,
                notifyGuests: false,
                addGoogleMeet: false,
                colorId: snap.colorId
            )
        case .eventEdit(let priorSnap):
            guard let event = event(id: priorSnap.id) else { return }
            let inclusiveEnd = priorSnap.isAllDay
                ? (Calendar.current.date(byAdding: .day, value: -1, to: priorSnap.endDate) ?? priorSnap.endDate)
                : priorSnap.endDate
            _ = await updateEvent(
                event,
                summary: priorSnap.summary,
                details: priorSnap.details,
                startDate: priorSnap.startDate,
                endDate: inclusiveEnd,
                isAllDay: priorSnap.isAllDay,
                reminderMinutes: priorSnap.reminderMinutes.first,
                calendarID: priorSnap.calendarID,
                location: priorSnap.location,
                recurrence: priorSnap.recurrence,
                attendeeEmails: priorSnap.attendeeEmails,
                notifyGuests: false,
                addGoogleMeet: false,
                colorId: priorSnap.colorId
            )
        }
    }

    func deleteTask(_ task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "deleting tasks") else {
            return false
        }
        // If the create is still pending, we can retract it locally: drop the
        // queued mutation and remove the optimistic row. No Google call needed.
        if OptimisticID.isPending(task.id) {
            pendingMutations.removeAll { mutation in
                mutation.resourceType == .task
                    && mutation.action == .create
                    && mutation.resourceID == task.id
            }
            removeTask(id: task.id)
            lastMutationError = nil
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        }

        let originalTask = task
        removeTask(id: task.id)

        beginMutation()
        do {
            try await tasksClient.deleteTask(taskListID: task.taskListID, taskID: task.id, ifMatch: task.etag)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            recordUndo(.taskDelete(snapshot: originalTask))
            return true
        } catch let error as GoogleAPIError where error.isTransient {
            let payload = PendingTaskDeletePayload(
                taskListID: task.taskListID,
                taskID: task.id,
                etagSnapshot: task.etag
            )
            if let mutation = try? PendingMutation.taskDelete(payload: payload) {
                pendingMutations.append(mutation)
                await saveCurrentState()
                await synchronizeLocalNotifications()
                endMutation(error: nil)
                Task { await replayPendingMutations() }
                return true
            }
            upsert(originalTask)
            endMutation(error: error)
            return false
        } catch {
            upsert(originalTask)
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    func createEvent(
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        reminderMinutes: Int?,
        calendarID: CalendarListMirror.ID,
        location: String = "",
        recurrence: [String] = [],
        attendeeEmails: [String] = [],
        notifyGuests: Bool = false,
        addGoogleMeet: Bool = false,
        colorId: String? = nil
    ) async -> Bool {
        guard requireAccount(mutationDescription: "creating events") else {
            return false
        }

        guard isValidEventRange(startDate: startDate, endDate: endDate, isAllDay: isAllDay) else {
            lastMutationError = isAllDay ? "All-day event end date cannot be before the start date." : "Event end time must be after the start time."
            return false
        }

        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let localID = OptimisticID.generate()
        let trimmedLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedEmails = attendeeEmails
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
        let optimisticEvent = CalendarEventMirror(
            id: localID,
            calendarID: calendarID,
            summary: trimmedSummary,
            details: trimmedDetails,
            startDate: startDate,
            endDate: endDate,
            isAllDay: isAllDay,
            status: .confirmed,
            recurrence: recurrence,
            etag: nil,
            updatedAt: Date(),
            reminderMinutes: reminderMinutes.map { [$0] } ?? [],
            location: trimmedLocation,
            attendeeEmails: cleanedEmails,
            attendeeResponses: cleanedEmails.map {
                CalendarEventAttendee(email: $0, displayName: nil, responseStatus: .needsAction)
            },
            meetLink: "",
            colorId: colorId
        )
        upsert(optimisticEvent)

        do {
            let payload = PendingEventCreatePayload(
                localID: localID,
                calendarID: calendarID,
                summary: trimmedSummary,
                details: trimmedDetails,
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes,
                location: trimmedLocation,
                recurrence: recurrence,
                attendeeEmails: cleanedEmails,
                notifyGuests: notifyGuests,
                addGoogleMeet: addGoogleMeet,
                colorId: colorId
            )
            let mutation = try PendingMutation.eventCreate(payload: payload)
            pendingMutations.append(mutation)
            await saveCurrentState()
        } catch {
            removeEvent(id: localID)
            lastMutationError = "Could not queue event for sync: \(error.localizedDescription)"
            return false
        }

        Task { await replayPendingMutations() }
        return true
    }

    enum RecurringEventScope: Sendable {
        case thisOccurrence
        case thisAndFollowing
        case allInSeries
    }

    func updateEvent(
        _ event: CalendarEventMirror,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        reminderMinutes: Int?,
        calendarID: CalendarListMirror.ID,
        location: String = "",
        recurrence: [String]? = nil,
        attendeeEmails: [String]? = nil,
        notifyGuests: Bool = false,
        scope: RecurringEventScope = .thisOccurrence,
        addGoogleMeet: Bool = false,
        colorId: String? = nil
    ) async -> Bool {
        guard requireAccount(mutationDescription: "updating events") else {
            return false
        }
        guard requirePersisted(event.id) else { return false }

        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedSummary.isEmpty == false else {
            lastMutationError = "Give the event a title before saving."
            return false
        }

        guard isValidEventRange(startDate: startDate, endDate: endDate, isAllDay: isAllDay) else {
            lastMutationError = isAllDay ? "All-day event end date cannot be before the start date." : "Event end time must be after the start time."
            return false
        }

        let trimmedDetails = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedEmails = (attendeeEmails ?? event.attendeeEmails)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
        let effectiveRecurrence = recurrence ?? event.recurrence

        // Optimistic update for the in-place (single-occurrence, same-calendar)
        // case. Cross-calendar moves and series-wide edits need server round-
        // trip semantics, so we keep the old state visible until confirmed.
        let originalEvent = event
        let canQueue = scope == .thisOccurrence && calendarID == event.calendarID
        if canQueue {
            var optimistic = event
            optimistic.summary = trimmedSummary
            optimistic.details = trimmedDetails
            optimistic.startDate = startDate
            optimistic.endDate = endDate
            optimistic.isAllDay = isAllDay
            optimistic.location = trimmedLocation
            optimistic.recurrence = effectiveRecurrence
            optimistic.attendeeEmails = cleanedEmails
            optimistic.reminderMinutes = reminderMinutes.map { [$0] } ?? []
            upsert(optimistic)
        }

        beginMutation()
        do {
            let eventToUpdate: CalendarEventMirror
            if calendarID != event.calendarID {
                // Cross-calendar moves on a recurring event need to use the
                // series ID for .allInSeries scope — Google treats a move of
                // the instance ID as a single-occurrence override with a
                // different parent calendar, which leaves the rest of the
                // series orphaned on the source calendar.
                let sourceID = scope == .allInSeries
                    ? CalendarEventInstance.seriesID(from: event.id)
                    : event.id
                eventToUpdate = try await calendarClient.moveEvent(
                    calendarID: event.calendarID,
                    eventID: sourceID,
                    destinationCalendarID: calendarID
                )
            } else {
                eventToUpdate = event
            }

            let targetEventID = scope == .allInSeries
                ? CalendarEventInstance.seriesID(from: eventToUpdate.id)
                : eventToUpdate.id

            let updatedEvent = try await calendarClient.updateEvent(
                calendarID: eventToUpdate.calendarID,
                eventID: targetEventID,
                summary: trimmedSummary,
                details: trimmedDetails,
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes,
                location: trimmedLocation,
                recurrence: effectiveRecurrence,
                attendeeEmails: cleanedEmails,
                sendUpdates: notifyGuests ? "all" : "none",
                addGoogleMeet: addGoogleMeet,
                colorId: colorId,
                ifMatch: scope == .allInSeries ? nil : eventToUpdate.etag
            )
            if calendarID != event.calendarID {
                removeEvent(id: event.id)
            }
            upsert(updatedEvent)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            if canQueue { recordUndo(.eventEdit(priorSnapshot: originalEvent)) }
            return true
        } catch let error as GoogleAPIError where error.isTransient && canQueue {
            let payload = PendingEventUpdatePayload(
                calendarID: event.calendarID,
                eventID: event.id,
                summary: trimmedSummary,
                details: trimmedDetails,
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes,
                location: trimmedLocation,
                recurrence: effectiveRecurrence,
                attendeeEmails: cleanedEmails,
                notifyGuests: notifyGuests,
                etagSnapshot: event.etag,
                addGoogleMeet: addGoogleMeet,
                colorId: colorId
            )
            if let mutation = try? PendingMutation.eventUpdate(payload: payload) {
                pendingMutations.append(mutation)
                await saveCurrentState()
                await synchronizeLocalNotifications()
                endMutation(error: nil)
                Task { await replayPendingMutations() }
                return true
            }
            upsert(originalEvent)
            endMutation(error: error)
            return false
        } catch {
            if canQueue { upsert(originalEvent) }
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    func deleteEvent(_ event: CalendarEventMirror, scope: RecurringEventScope = .thisOccurrence) async -> Bool {
        guard requireAccount(mutationDescription: "deleting events") else {
            return false
        }
        // Retract a still-pending event create locally without calling Google.
        if OptimisticID.isPending(event.id) {
            pendingMutations.removeAll { mutation in
                mutation.resourceType == .event
                    && mutation.action == .create
                    && mutation.resourceID == event.id
            }
            removeEvent(id: event.id)
            lastMutationError = nil
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        }

        let originalEvent = event
        let canQueue = scope == .thisOccurrence
        if canQueue {
            removeEvent(id: event.id)
        }

        beginMutation()
        do {
            if scope == .thisAndFollowing {
                // Fetch the master so we have its current RRULE(s), then rewrite
                // each with an UNTIL clause that falls before this instance —
                // the instance itself and every future one disappear from the
                // series on the next sync. No delete verb is issued: truncation
                // alone removes future occurrences.
                let seriesID = CalendarEventInstance.seriesID(from: event.id)
                let master = try await calendarClient.getEvent(calendarID: event.calendarID, eventID: seriesID)
                let cutoff = Calendar.current.date(byAdding: .second, value: -1, to: event.startDate) ?? event.startDate
                let untilString = RecurrenceUntilRewriter.untilString(fromCutoff: cutoff, isAllDay: master.isAllDay)
                let rewritten = master.recurrence.map { RecurrenceUntilRewriter.rewrite(rrule: $0, until: untilString) }
                _ = try await calendarClient.patchEventRecurrence(
                    calendarID: event.calendarID,
                    eventID: seriesID,
                    recurrence: rewritten,
                    ifMatch: master.etag
                )
                // Drop the instance and every later instance of the same series
                // from the local mirror so the grid updates before the next
                // sync reconciles.
                let dropID = seriesID
                events.removeAll { existing in
                    guard CalendarEventInstance.seriesID(from: existing.id) == dropID else { return false }
                    return existing.startDate >= event.startDate
                }
                rebuildSnapshots()
                endMutation(error: nil)
                await saveCurrentState()
                await synchronizeLocalNotifications()
                recordUndo(.eventDelete(snapshot: originalEvent))
                return true
            }
            let targetEventID = scope == .allInSeries
                ? CalendarEventInstance.seriesID(from: event.id)
                : event.id
            let ifMatch: String? = scope == .allInSeries ? nil : event.etag
            try await calendarClient.deleteEvent(
                calendarID: event.calendarID,
                eventID: targetEventID,
                ifMatch: ifMatch
            )
            if scope == .allInSeries {
                let seriesID = CalendarEventInstance.seriesID(from: event.id)
                events.removeAll { CalendarEventInstance.seriesID(from: $0.id) == seriesID }
                rebuildSnapshots()
            }
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            if canQueue { recordUndo(.eventDelete(snapshot: originalEvent)) }
            return true
        } catch let error as GoogleAPIError where error.isTransient && canQueue {
            let payload = PendingEventDeletePayload(
                calendarID: event.calendarID,
                eventID: event.id,
                etagSnapshot: event.etag
            )
            if let mutation = try? PendingMutation.eventDelete(payload: payload) {
                pendingMutations.append(mutation)
                await saveCurrentState()
                await synchronizeLocalNotifications()
                endMutation(error: nil)
                Task { await replayPendingMutations() }
                return true
            }
            upsert(originalEvent)
            endMutation(error: error)
            return false
        } catch {
            if canQueue { upsert(originalEvent) }
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    func updateSyncMode(_ mode: SyncMode) {
        settings.syncMode = mode
        Task {
            await saveCurrentState()
        }
    }

    func setShowMenuBarExtra(_ isEnabled: Bool) {
        guard settings.showMenuBarExtra != isEnabled else {
            return
        }
        settings.showMenuBarExtra = isEnabled
        Task { await saveCurrentState() }
    }

    func setShowDockBadge(_ isEnabled: Bool) {
        guard settings.showDockBadge != isEnabled else {
            return
        }
        settings.showDockBadge = isEnabled
        Task { await saveCurrentState() }
    }

    func setEnableGlobalHotkey(_ isEnabled: Bool) {
        guard settings.enableGlobalHotkey != isEnabled else { return }
        settings.enableGlobalHotkey = isEnabled
        Task { await saveCurrentState() }
    }

    func setSidebarItemHidden(_ item: SidebarItem, hidden: Bool) {
        guard item.isHideable else { return } // Settings is always visible
        var next = settings.hiddenSidebarItems
        if hidden {
            next.insert(item.rawValue)
        } else {
            next.remove(item.rawValue)
        }
        guard next != settings.hiddenSidebarItems else { return }
        settings.hiddenSidebarItems = next
        Task { await saveCurrentState() }
    }

    func setCalendarViewModeHidden(_ mode: CalendarGridMode, hidden: Bool) {
        var next = settings.hiddenCalendarViewModes
        if hidden {
            // never hide every mode — Calendar tab needs at least one visible
            let wouldRemainVisible = CalendarGridMode.allCases.contains { other in
                other != mode && next.contains(other.rawValue) == false
            }
            guard wouldRemainVisible else { return }
            next.insert(mode.rawValue)
        } else {
            next.remove(mode.rawValue)
        }
        guard next != settings.hiddenCalendarViewModes else { return }
        settings.hiddenCalendarViewModes = next
        Task { await saveCurrentState() }
    }

    func setStoreViewModeHidden(_ mode: StoreViewMode, hidden: Bool) {
        var next = settings.hiddenStoreViewModes
        if hidden {
            // Same invariant as Calendar: at least one view mode stays visible
            // so the Store tab doesn't render an empty detail pane.
            let wouldRemainVisible = StoreViewMode.allCases.contains { other in
                other != mode && next.contains(other.rawValue) == false
            }
            guard wouldRemainVisible else { return }
            next.insert(mode.rawValue)
        } else {
            next.remove(mode.rawValue)
        }
        guard next != settings.hiddenStoreViewModes else { return }
        settings.hiddenStoreViewModes = next
        Task { await saveCurrentState() }
    }

    func updateSettings(_ next: AppSettings) {
        guard settings != next else { return }
        settings = next
        Task { await saveCurrentState() }
    }

    func setUILayoutScale(_ scale: Double) {
        guard settings.uiLayoutScale != scale else { return }
        settings.uiLayoutScale = scale
        Task { await saveCurrentState() }
    }

    func setUITextSizePoints(_ points: Double) {
        let clamped = HCBTextSize.clamp(points)
        guard settings.uiTextSizePoints != clamped else { return }
        settings.uiTextSizePoints = clamped
        Task { await saveCurrentState() }
    }

    func setUIFontName(_ name: String?) {
        let normalized = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = (normalized?.isEmpty ?? true) ? nil : normalized
        guard settings.uiFontName != resolved else { return }
        settings.uiFontName = resolved
        Task { await saveCurrentState() }
    }

    func setColorSchemeID(_ id: String) {
        guard settings.colorSchemeID != id else { return }
        guard HCBColorScheme.scheme(id: id) != nil else { return }
        settings.colorSchemeID = id
        Task { await saveCurrentState() }
    }

    func setShortcutBinding(_ command: HCBShortcutCommand, binding: HCBKeyBinding?) {
        if let binding {
            settings.shortcutOverrides[command.rawValue] = binding
        } else {
            settings.shortcutOverrides.removeValue(forKey: command.rawValue)
        }
        HCBShortcutStorage.persist(settings.shortcutOverrides)
        Task { await saveCurrentState() }
    }

    func resetAllShortcutBindings() {
        guard settings.shortcutOverrides.isEmpty == false else { return }
        settings.shortcutOverrides.removeAll()
        HCBShortcutStorage.persist(settings.shortcutOverrides)
        Task { await saveCurrentState() }
    }

    func upsertCustomFilter(_ filter: CustomFilterDefinition) {
        if let index = settings.customFilters.firstIndex(where: { $0.id == filter.id }) {
            settings.customFilters[index] = filter
        } else {
            settings.customFilters.append(filter)
        }
        Task { await saveCurrentState() }
    }

    func deleteCustomFilter(_ id: CustomFilterDefinition.ID) {
        settings.customFilters.removeAll { $0.id == id }
        Task { await saveCurrentState() }
    }

    func upsertEventTemplate(_ template: EventTemplate) {
        if let index = settings.eventTemplates.firstIndex(where: { $0.id == template.id }) {
            settings.eventTemplates[index] = template
        } else {
            settings.eventTemplates.append(template)
        }
        Task { await saveCurrentState() }
    }

    func deleteEventTemplate(_ id: EventTemplate.ID) {
        settings.eventTemplates.removeAll { $0.id == id }
        Task { await saveCurrentState() }
    }

    func bulkDeleteEvents(_ events: [CalendarEventMirror]) async -> Int {
        var deleted = 0
        for event in events {
            if await deleteEvent(event, scope: .thisOccurrence) {
                deleted += 1
            }
        }
        return deleted
    }

    // Adds a #tag token to the task title. Idempotent: if the tag is already
    // present (case-insensitive), no API call is issued.
    func addTag(_ tag: String, to task: TaskMirror) async -> Bool {
        let normalized = tag.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.isEmpty == false else {
            lastMutationError = "Tag is empty."
            return false
        }
        let existing = Set(TagExtractor.tags(in: task.title).map { $0.lowercased() })
        if existing.contains(normalized.lowercased()) { return true }
        let newTitle = task.title.trimmingCharacters(in: .whitespaces).isEmpty
            ? "#\(normalized)"
            : "\(task.title.trimmingCharacters(in: .whitespaces)) #\(normalized)"
        return await updateTask(task, title: newTitle, notes: task.notes, dueDate: task.dueDate)
    }

    // Removes a specific #tag token (case-insensitive) from the task title.
    // Idempotent: if the tag isn't present, no API call is issued.
    func removeTag(_ tag: String, from task: TaskMirror) async -> Bool {
        let normalized = tag.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.isEmpty == false else {
            lastMutationError = "Tag is empty."
            return false
        }
        let existing = Set(TagExtractor.tags(in: task.title).map { $0.lowercased() })
        guard existing.contains(normalized.lowercased()) else { return true }
        // Match `#tag` preceded by whitespace or start, ending on a non-[A-Za-z0-9_-]
        // boundary — so `#work` doesn't clobber `#workout`. TagExtractor allows
        // letters/digits/underscore/hyphen as tag chars, so the boundary is any
        // char outside that set or end-of-string.
        let escaped = NSRegularExpression.escapedPattern(for: normalized)
        let pattern = "(^|\\s)#\(escaped)(?![A-Za-z0-9_\\-])"
        let cleaned = (try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]))
            .map { $0.stringByReplacingMatches(in: task.title, range: NSRange(task.title.startIndex..., in: task.title), withTemplate: "$1") }
            ?? task.title
        let collapsed = cleaned
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if collapsed == task.title { return true }
        return await updateTask(task, title: collapsed, notes: task.notes, dueDate: task.dueDate)
    }

    // Bulk entry point: runs the optimizer, throttles dispatch, aggregates
    // per-op success/failure. Each op still routes through the optimistic-write
    // helpers so offline queue + etag conflict paths apply.
    //
    // throttleInterval caps request rate against Google's per-user-per-100s
    // quota. 40 ms ≈ 25 req/s, safely under the documented 100 req/100s bucket.
    func performBulkTaskOperations(
        _ ops: [BulkTaskOperation],
        throttleInterval: Duration = .milliseconds(40)
    ) async -> BulkTaskExecutionResult {
        let optimized = BulkTaskOptimizer.optimize(ops, currentTasks: tasks)
        guard optimized.operations.isEmpty == false else {
            return BulkTaskExecutionResult(
                submitted: 0,
                succeeded: 0,
                failures: [],
                droppedAsNoOp: optimized.droppedCount
            )
        }

        var succeeded = 0
        var failures: [BulkTaskFailure] = []
        var lastDispatchedAt: Date?
        for op in optimized.operations {
            if let last = lastDispatchedAt {
                // Token-bucket substitute: sleep until `throttleInterval` has
                // elapsed since the previous dispatch. Simple, deterministic,
                // no background task needed.
                let elapsed = Duration.seconds(max(0, Date().timeIntervalSince(last)))
                let remaining = throttleInterval - elapsed
                if remaining > .zero {
                    try? await Task.sleep(for: remaining)
                }
            }
            lastDispatchedAt = Date()

            let ok = await dispatchBulkOperation(op)
            if ok {
                succeeded += 1
            } else {
                failures.append(
                    BulkTaskFailure(
                        operation: op,
                        message: lastMutationError ?? "Operation failed."
                    )
                )
            }
        }

        return BulkTaskExecutionResult(
            submitted: optimized.operations.count,
            succeeded: succeeded,
            failures: failures,
            droppedAsNoOp: optimized.droppedCount
        )
    }

    private func dispatchBulkOperation(_ op: BulkTaskOperation) async -> Bool {
        // Re-resolve from current mirror — a previous op in the same batch may
        // have mutated this task (e.g., moveToList changes taskListID + etag).
        guard let task = self.task(id: op.taskId) else { return false }
        switch op {
        case .complete: return await setTaskCompleted(true, task: task)
        case .reopen: return await setTaskCompleted(false, task: task)
        case .delete: return await deleteTask(task)
        case .setDue(_, let dueDate): return await updateTask(task, title: task.title, notes: task.notes, dueDate: dueDate)
        case .moveToList(_, let targetListId): return await moveTaskToList(task, toTaskListID: targetListId)
        case .setStarred(_, let starred):
            if TaskStarring.isStarred(task) == starred { return true }
            return await toggleTaskStar(task)
        case .addTag(_, let tag): return await addTag(tag, to: task)
        case .removeTag(_, let tag): return await removeTag(tag, from: task)
        }
    }

    func bulkShiftEvents(_ events: [CalendarEventMirror], byMinutes minutes: Int) async -> Int {
        guard minutes != 0 else { return 0 }
        var shifted = 0
        for event in events {
            guard event.isAllDay == false else { continue }
            let newStart = event.startDate.addingTimeInterval(TimeInterval(minutes) * 60)
            let newEnd = event.endDate.addingTimeInterval(TimeInterval(minutes) * 60)
            let didUpdate = await updateEvent(
                event,
                summary: event.summary,
                details: event.details,
                startDate: newStart,
                endDate: newEnd,
                isAllDay: event.isAllDay,
                reminderMinutes: event.reminderMinutes.first,
                calendarID: event.calendarID,
                location: event.location,
                scope: .thisOccurrence
            )
            if didUpdate { shifted += 1 }
        }
        return shifted
    }

    func saveAsEventTemplate(_ event: CalendarEventMirror, name: String) {
        let duration = max(Int(event.endDate.timeIntervalSince(event.startDate) / 60), 15)
        let template = EventTemplate(
            name: name,
            summary: event.summary,
            details: event.details,
            location: event.location,
            durationMinutes: duration,
            isAllDay: event.isAllDay,
            reminderMinutes: event.reminderMinutes.first,
            colorId: event.colorId,
            attendees: event.attendeeEmails,
            addGoogleMeet: event.meetLink.isEmpty == false
        )
        upsertEventTemplate(template)
    }

    func setShowDetailedMenuBar(_ isEnabled: Bool) {
        guard settings.showDetailedMenuBar != isEnabled else {
            return
        }
        settings.showDetailedMenuBar = isEnabled
        Task { await saveCurrentState() }
    }

    func setMenuBarStyle(_ style: AppSettings.MenuBarStyle) {
        guard settings.menuBarStyle != style else { return }
        settings.menuBarStyle = style
        // Keep legacy bool in sync so older reads don't misreport
        settings.showDetailedMenuBar = (style == .detailed)
        Task { await saveCurrentState() }
    }

    func updateLocalNotificationsEnabled(_ isEnabled: Bool) {
        settings.enableLocalNotifications = isEnabled
        Task {
            await saveCurrentState()
            await synchronizeLocalNotifications(requestAuthorization: isEnabled)
        }
    }

    func completeOnboarding() {
        settings.hasCompletedOnboarding = true
        Task {
            await saveCurrentState()
        }
    }

    func resetOnboarding() {
        settings.hasCompletedOnboarding = false
        Task {
            await saveCurrentState()
        }
    }

    func clearFailureState() {
        if case .failed = syncState {
            syncState = .idle
        }

        if case .failed = authState {
            authState = account.map(AuthState.signedIn) ?? .signedOut
        }

        lastMutationError = nil
    }

    func replayPendingMutations() async {
        guard account != nil else { return }
        guard pendingMutations.isEmpty == false else { return }
        AppLogger.info("replay start", category: .replay, metadata: ["queued": String(pendingMutations.count)])
        // Serialise replay loops: `createTask` / `createEvent` spawn detached
        // `Task { replayPendingMutations() }` calls and `refreshNow` also
        // calls us. Without this flag two loops can pass each mutation's
        // "still queued" guard simultaneously and both fire insertTask,
        // creating a duplicate on Google.
        guard isReplayingMutations == false else { return }
        isReplayingMutations = true
        defer { isReplayingMutations = false }

        // Cap how many times we re-enter the loop to avoid spinning on a
        // mutation that keeps getting retried (transient error that never
        // resolves within this activation). Each pass we only keep going
        // if we made progress — which guarantees termination either by
        // draining or by stabilising on a non-shrinking queue.
        let maxPasses = 4
        var processedIDs: Set<PendingMutation.ID> = []
        for _ in 0..<maxPasses {
            let snapshot = pendingMutations.filter { processedIDs.contains($0.id) == false }
            guard snapshot.isEmpty == false else { break }
            for mutation in snapshot {
                guard pendingMutations.contains(where: { $0.id == mutation.id }) else {
                    processedIDs.insert(mutation.id)
                    continue
                }
                await replay(mutation)
                processedIDs.insert(mutation.id)
            }
            // If nothing new was added during this pass, we're done.
            let remaining = pendingMutations.filter { processedIDs.contains($0.id) == false }
            if remaining.isEmpty { break }
        }
    }

    private func replay(_ mutation: PendingMutation) async {
        switch (mutation.resourceType, mutation.action) {
        case (.task, .create):
            await replayTaskCreate(mutation)
        case (.event, .create):
            await replayEventCreate(mutation)
        case (.task, .update):
            await replayTaskUpdate(mutation)
        case (.task, .completion):
            await replayTaskCompletion(mutation)
        case (.task, .delete):
            await replayTaskDelete(mutation)
        case (.event, .update):
            await replayEventUpdate(mutation)
        case (.event, .delete):
            await replayEventDelete(mutation)
        default:
            pendingMutations.removeAll { $0.id == mutation.id }
        }
    }

    private func replayTaskCreate(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeTaskCreate(mutation.payload)
            let parent = payload.parentID.flatMap { id -> String? in
                OptimisticID.isPending(id) ? nil : id
            }
            let created = try await tasksClient.insertTask(
                taskListID: payload.taskListID,
                title: payload.title,
                notes: payload.notes,
                dueDate: payload.dueDate,
                parent: parent
            )
            removeTask(id: payload.localID)
            upsert(created)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch {
            if let payload = try? PendingMutationEncoder.decodeTaskCreate(mutation.payload) {
                removeTask(id: payload.localID)
            }
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Task couldn't be created: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func replayTaskUpdate(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeTaskUpdate(mutation.payload)
            let updated = try await tasksClient.updateTask(
                taskListID: payload.taskListID,
                taskID: payload.taskID,
                title: payload.title,
                notes: payload.notes,
                dueDate: payload.dueDate,
                ifMatch: payload.etagSnapshot
            )
            upsert(updated)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            // Queued edit was based on stale state — drop it and refresh so
            // the user can re-apply against the current server state.
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "A queued edit was rejected because the item changed elsewhere. Refreshing."
            await saveCurrentState()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued task update failed: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func replayTaskCompletion(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeTaskCompletion(mutation.payload)
            // Reconstruct a minimal TaskMirror so tasksClient.setTaskCompleted
            // can pass the snapshot etag via If-Match.
            let stub = TaskMirror(
                id: payload.taskID,
                taskListID: payload.taskListID,
                parentID: nil,
                title: "",
                notes: "",
                status: payload.isCompleted ? .completed : .needsAction,
                dueDate: nil,
                completedAt: nil,
                isDeleted: false,
                isHidden: false,
                position: nil,
                etag: payload.etagSnapshot,
                updatedAt: nil
            )
            let updated = try await tasksClient.setTaskCompleted(payload.isCompleted, task: stub)
            upsert(updated)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "A queued completion was rejected because the task changed elsewhere. Refreshing."
            await saveCurrentState()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued completion failed: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func replayTaskDelete(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeTaskDelete(mutation.payload)
            try await tasksClient.deleteTask(
                taskListID: payload.taskListID,
                taskID: payload.taskID,
                ifMatch: payload.etagSnapshot
            )
            removeTask(id: payload.taskID)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "A queued delete was rejected because the task changed elsewhere. Refreshing."
            await saveCurrentState()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued delete failed: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func replayEventUpdate(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeEventUpdate(mutation.payload)
            let updated = try await calendarClient.updateEvent(
                calendarID: payload.calendarID,
                eventID: payload.eventID,
                summary: payload.summary,
                details: payload.details,
                startDate: payload.startDate,
                endDate: payload.endDate,
                isAllDay: payload.isAllDay,
                reminderMinutes: payload.reminderMinutes,
                location: payload.location,
                recurrence: payload.recurrence,
                attendeeEmails: payload.attendeeEmails,
                sendUpdates: payload.notifyGuests ? "all" : "none",
                addGoogleMeet: payload.addGoogleMeet,
                colorId: payload.colorId,
                ifMatch: payload.etagSnapshot
            )
            upsert(updated)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "A queued edit was rejected because the event changed elsewhere. Refreshing."
            await saveCurrentState()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued event update failed: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func replayEventDelete(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeEventDelete(mutation.payload)
            try await calendarClient.deleteEvent(
                calendarID: payload.calendarID,
                eventID: payload.eventID,
                ifMatch: payload.etagSnapshot
            )
            removeEvent(id: payload.eventID)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "A queued delete was rejected because the event changed elsewhere. Refreshing."
            await saveCurrentState()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued event delete failed: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func replayEventCreate(_ mutation: PendingMutation) async {
        do {
            let payload = try PendingMutationEncoder.decodeEventCreate(mutation.payload)
            let created = try await calendarClient.insertEvent(
                calendarID: payload.calendarID,
                summary: payload.summary,
                details: payload.details,
                startDate: payload.startDate,
                endDate: payload.endDate,
                isAllDay: payload.isAllDay,
                reminderMinutes: payload.reminderMinutes,
                location: payload.location,
                recurrence: payload.recurrence,
                attendeeEmails: payload.attendeeEmails,
                sendUpdates: payload.notifyGuests ? "all" : "none",
                addGoogleMeet: payload.addGoogleMeet,
                colorId: payload.colorId
            )
            removeEvent(id: payload.localID)
            upsert(created)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
        } catch {
            if let payload = try? PendingMutationEncoder.decodeEventCreate(mutation.payload) {
                removeEvent(id: payload.localID)
            }
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Event couldn't be created: \(error.localizedDescription)"
            await saveCurrentState()
        }
    }

    private func requireAccount(mutationDescription: String) -> Bool {
        guard account != nil else {
            lastMutationError = "Sign in to Google in Settings to \(mutationDescription)."
            return false
        }
        return true
    }

    // Reject mutations that target an item whose create is still waiting to
    // hit Google. The server-side ID doesn't exist yet, so PATCH/DELETE would
    // 404 and leave the UI in an indeterminate state.
    private func requirePersisted(_ id: String) -> Bool {
        guard OptimisticID.isPending(id) else { return true }
        lastMutationError = "This item is still syncing to Google. Try again once the pending sync indicator clears."
        return false
    }

    private func beginMutation() {
        mutationCount += 1
        lastMutationError = nil
    }

    private func endMutation(error: Error?) {
        mutationCount = max(0, mutationCount - 1)
        if let error {
            lastMutationError = error.localizedDescription
            var meta: [String: String] = ["error": String(describing: error)]
            if case let GoogleAPIError.httpStatus(status, _) = error {
                meta["status"] = String(status)
            }
            AppLogger.warn("mutation failed", category: .mutation, metadata: meta)
        }
    }

    func forceFullResync() async {
        syncCheckpoints = []
        await saveCurrentState()
        await refreshNow()
    }

    func clearCachedGoogleDataAndRefresh() async {
        taskLists = []
        tasks = []
        calendars = []
        events = []
        syncCheckpoints = []
        pendingMutations = []
        rebuildSnapshots()
        syncState = .idle
        await saveCurrentState()
        await spotlightIndexer.removeAll()
        await synchronizeLocalNotifications()

        if account != nil {
            await refreshNow()
        }
    }

    func cacheFilePath() async -> String {
        await cacheStore.cacheFilePath() ?? "In-memory cache only"
    }

    func diagnosticSummary(cachePath: String) -> String {
        let accountLabel = account?.displayName ?? authState.title
        let lastSync = lastSuccessfulSyncAt?.formatted(date: .abbreviated, time: .standard) ?? "Never"
        let selectedTaskLists = settings.hasConfiguredTaskListSelection ? settings.selectedTaskListIDs.count : taskLists.count
        let selectedCalendars = settings.hasConfiguredCalendarSelection ? settings.selectedCalendarIDs.count : calendars.filter(\.isSelected).count

        return """
        Hot Cross Buns Diagnostics
        Account: \(accountLabel)
        Auth state: \(authState.title)
        Sync state: \(syncState.title)
        Sync mode: \(settings.syncMode.title)
        Last successful sync: \(lastSync)
        Task lists: \(taskLists.count)
        Selected task lists: \(selectedTaskLists)
        Tasks: \(tasks.count)
        Calendars: \(calendars.count)
        Selected calendars: \(selectedCalendars)
        Events: \(events.count)
        Sync checkpoints: \(syncCheckpoints.count)
        Pending writes: \(pendingMutations.count)
        Local reminders: \(settings.enableLocalNotifications ? "enabled" : "disabled")
        Onboarding: \(settings.hasCompletedOnboarding ? "completed" : "not completed")
        Cache path: \(cachePath)
        """
    }

    func toggleCalendar(_ calendarID: CalendarListMirror.ID) {
        guard let index = calendars.firstIndex(where: { $0.id == calendarID }) else {
            return
        }
        calendars[index].isSelected.toggle()
        settings.hasConfiguredCalendarSelection = true
        settings.selectedCalendarIDs = Set(calendars.filter(\.isSelected).map(\.id))
        rebuildSnapshots()
        Task {
            await saveCurrentState()
        }
    }

    func isTaskListSelected(_ taskListID: TaskListMirror.ID) -> Bool {
        if settings.hasConfiguredTaskListSelection {
            return settings.selectedTaskListIDs.contains(taskListID)
        }

        return true
    }

    func toggleTaskList(_ taskListID: TaskListMirror.ID) {
        guard taskLists.contains(where: { $0.id == taskListID }) else {
            return
        }

        var selectedIDs = settings.hasConfiguredTaskListSelection
            ? settings.selectedTaskListIDs
            : Set(taskLists.map(\.id))

        if selectedIDs.contains(taskListID) {
            selectedIDs.remove(taskListID)
        } else {
            selectedIDs.insert(taskListID)
        }

        settings.hasConfiguredTaskListSelection = true
        settings.selectedTaskListIDs = selectedIDs
        rebuildSnapshots()
        Task {
            await saveCurrentState()
        }
    }

    func task(id: TaskMirror.ID) -> TaskMirror? {
        tasks.first(where: { $0.id == id })
    }

    func event(id: CalendarEventMirror.ID) -> CalendarEventMirror? {
        events.first(where: { $0.id == id })
    }

    private func apply(_ state: CachedAppState) {
        account = state.account
        taskLists = state.taskLists
        tasks = state.tasks
        calendars = state.calendars
        events = state.events
        settings = state.settings
        syncCheckpoints = state.syncCheckpoints
        pendingMutations = state.pendingMutations
        HCBColorSchemeStore.current = HCBColorScheme.scheme(id: settings.colorSchemeID) ?? .notion
        HCBShortcutStorage.persist(settings.shortcutOverrides)
        rebuildSnapshots()
    }

    private func installPreviewData() {
        apply(.preview)
        authState = .signedIn(.preview)
        syncState = .synced(at: Date())
    }

    private func upsert(_ task: TaskMirror) {
        if let index = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[index] = task
        } else {
            tasks.append(task)
        }
        rebuildSnapshots()
    }

    private func upsert(_ taskList: TaskListMirror) {
        if let index = taskLists.firstIndex(where: { $0.id == taskList.id }) {
            taskLists[index] = taskList
        } else {
            taskLists.append(taskList)
        }
        rebuildSnapshots()
    }

    private func removeTaskList(id: TaskListMirror.ID) {
        taskLists.removeAll { $0.id == id }
        tasks.removeAll { $0.taskListID == id }
        settings.selectedTaskListIDs.remove(id)
        syncCheckpoints.removeAll { checkpoint in
            checkpoint.resourceType == .taskList && checkpoint.resourceID == id
        }
        rebuildSnapshots()
    }

    private func removeTask(id: TaskMirror.ID) {
        tasks.removeAll { $0.id == id }
        rebuildSnapshots()
    }

    private func upsert(_ event: CalendarEventMirror) {
        var resolved = event
        // When Google reports useDefault=true and no explicit overrides,
        // surface the calendar's defaultReminders so the local-notification
        // scheduler fires at the user's actual configured offset instead
        // of a hard-coded fallback. Only applies to timed events — all-day
        // Google events don't honour the default in Calendar either.
        if resolved.usedDefaultReminders,
           resolved.reminderMinutes.isEmpty,
           resolved.isAllDay == false,
           let cal = calendars.first(where: { $0.id == resolved.calendarID }),
           cal.defaultReminderMinutes.isEmpty == false {
            resolved.reminderMinutes = cal.defaultReminderMinutes
        }
        if let index = events.firstIndex(where: { $0.id == resolved.id }) {
            events[index] = resolved
        } else {
            events.append(resolved)
        }
        rebuildSnapshots()
    }

    private func removeEvent(id: CalendarEventMirror.ID) {
        events.removeAll { $0.id == id }
        rebuildSnapshots()
    }

    private func currentCachedState() -> CachedAppState {
        CachedAppState(
            account: account,
            taskLists: taskLists,
            tasks: tasks,
            calendars: calendars,
            events: events,
            settings: settings,
            syncCheckpoints: syncCheckpoints,
            pendingMutations: pendingMutations
        )
    }

    private func saveCurrentState() async {
        await cacheStore.save(currentCachedState())
    }

    private func isValidEventRange(startDate: Date, endDate: Date, isAllDay: Bool) -> Bool {
        if isAllDay {
            return Calendar.current.startOfDay(for: endDate) >= Calendar.current.startOfDay(for: startDate)
        }

        return endDate > startDate
    }

    func notificationScheduleSummary() async -> NotificationScheduleSummary? {
        await notificationScheduler.lastSummary
    }

    private func synchronizeLocalNotifications(requestAuthorization: Bool = false) async {
        await notificationScheduler.synchronize(
            tasks: tasks,
            events: events,
            settings: settings,
            requestAuthorization: requestAuthorization
        )
        await spotlightIndexer.update(tasks: tasks, events: events)
    }

    private func rebuildSnapshots(referenceDate: Date = Date()) {
        let visibleTaskListIDs = settings.hasConfiguredTaskListSelection
            ? settings.selectedTaskListIDs
            : Set(taskLists.map(\.id))
        let visibleTaskLists = taskLists.filter { visibleTaskListIDs.contains($0.id) }
        let visibleTasks = tasks.filter { visibleTaskListIDs.contains($0.taskListID) }

        taskSections = TaskListSectionSnapshot.build(taskLists: visibleTaskLists, tasks: visibleTasks)
        todaySnapshot = TodaySnapshot.build(tasks: visibleTasks, events: events, referenceDate: referenceDate)
        calendarSnapshot = CalendarSnapshot.build(calendars: calendars, events: events, referenceDate: referenceDate)

        // Precompute the sidebar open-task count so the badge doesn't have
        // to re-filter every render.
        openTaskCountForSidebar = visibleTasks.reduce(into: 0) { acc, task in
            if task.isCompleted == false && task.isDeleted == false {
                acc += 1
            }
        }

        // Precompute completion stats per list. Walks `tasks` once rather
        // than once-per-section during Store render.
        var stats: [TaskListMirror.ID: TaskListCompletionStats] = [:]
        for task in tasks where task.isDeleted == false {
            var entry = stats[task.taskListID] ?? TaskListCompletionStats(total: 0, completed: 0)
            entry.total += 1
            if task.isCompleted { entry.completed += 1 }
            stats[task.taskListID] = entry
        }
        taskListCompletionStats = stats
    }
}

struct TaskListCompletionStats: Equatable, Sendable {
    var total: Int
    var completed: Int
    var openCount: Int { total - completed }
    var fraction: Double { total == 0 ? 0 : Double(completed) / Double(total) }
}
