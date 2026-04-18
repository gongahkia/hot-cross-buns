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
    private(set) var isMutating: Bool = false
    private(set) var lastMutationError: String?
    private(set) var taskLists: [TaskListMirror] = []
    private(set) var tasks: [TaskMirror] = []
    private(set) var calendars: [CalendarListMirror] = []
    private(set) var events: [CalendarEventMirror] = []
    private(set) var taskSections: [TaskListSectionSnapshot] = []
    private(set) var todaySnapshot: TodaySnapshot = .empty
    private(set) var calendarSnapshot: CalendarSnapshot = .empty
    private(set) var syncCheckpoints: [SyncCheckpoint] = []
    private(set) var pendingMutations: [PendingMutation] = []
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
        let cachedState = await cacheStore.loadCachedState()
        apply(cachedState)
        authState = cachedState.account.map(AuthState.signedIn) ?? .signedOut
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
            return .skipped // defer refresh until mutation settles to avoid state races
        }

        guard account != nil else {
            syncState = .failed(message: "Connect Google before syncing.")
            return .skipped
        }

        syncState = .syncing(startedAt: Date())
        await replayPendingMutations()
        do {
            let syncedState = try await syncScheduler.syncNow(
                mode: settings.syncMode,
                baseState: currentCachedState()
            )
            apply(syncedState)
            authState = syncedState.account.map(AuthState.signedIn) ?? .signedOut
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return .succeeded
        } catch {
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

    func indentTask(_ task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "indenting tasks") else { return false }
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

    func outdentTask(_ task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "outdenting tasks") else { return false }
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
            lastMutationError = "Task list title cannot be empty."
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
            lastMutationError = "Task list title cannot be empty."
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

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            lastMutationError = "Task title cannot be empty."
            return false
        }

        beginMutation()
        do {
            let updatedTask = try await tasksClient.updateTask(
                taskListID: task.taskListID,
                taskID: task.id,
                title: trimmedTitle,
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
                dueDate: dueDate,
                ifMatch: task.etag
            )
            upsert(updatedTask)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    func setTaskCompleted(_ isCompleted: Bool, task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "updating tasks") else {
            return false
        }

        beginMutation()
        do {
            let updatedTask = try await tasksClient.setTaskCompleted(isCompleted, task: task)
            upsert(updatedTask)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            endMutation(error: error)
            return false
        }
    }

    func deleteTask(_ task: TaskMirror) async -> Bool {
        guard requireAccount(mutationDescription: "deleting tasks") else {
            return false
        }

        beginMutation()
        do {
            try await tasksClient.deleteTask(taskListID: task.taskListID, taskID: task.id)
            removeTask(id: task.id)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
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
        calendarID: CalendarListMirror.ID
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
        let optimisticEvent = CalendarEventMirror(
            id: localID,
            calendarID: calendarID,
            summary: trimmedSummary,
            details: trimmedDetails,
            startDate: startDate,
            endDate: endDate,
            isAllDay: isAllDay,
            status: .confirmed,
            recurrence: [],
            etag: nil,
            updatedAt: Date(),
            reminderMinutes: reminderMinutes.map { [$0] } ?? []
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
                reminderMinutes: reminderMinutes
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

    func updateEvent(
        _ event: CalendarEventMirror,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        reminderMinutes: Int?,
        calendarID: CalendarListMirror.ID
    ) async -> Bool {
        guard requireAccount(mutationDescription: "updating events") else {
            return false
        }

        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedSummary.isEmpty == false else {
            lastMutationError = "Event summary cannot be empty."
            return false
        }

        guard isValidEventRange(startDate: startDate, endDate: endDate, isAllDay: isAllDay) else {
            lastMutationError = isAllDay ? "All-day event end date cannot be before the start date." : "Event end time must be after the start time."
            return false
        }

        beginMutation()
        do {
            let eventToUpdate: CalendarEventMirror
            if calendarID != event.calendarID {
                eventToUpdate = try await calendarClient.moveEvent(
                    calendarID: event.calendarID,
                    eventID: event.id,
                    destinationCalendarID: calendarID
                )
            } else {
                eventToUpdate = event
            }

            let updatedEvent = try await calendarClient.updateEvent(
                calendarID: eventToUpdate.calendarID,
                eventID: eventToUpdate.id,
                summary: trimmedSummary,
                details: details.trimmingCharacters(in: .whitespacesAndNewlines),
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes,
                ifMatch: eventToUpdate.etag
            )
            if calendarID != event.calendarID {
                removeEvent(id: event.id)
            }
            upsert(updatedEvent)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            if let apiError = error as? GoogleAPIError, apiError == .preconditionFailed {
                await refreshNow()
            }
            endMutation(error: error)
            return false
        }
    }

    func deleteEvent(_ event: CalendarEventMirror) async -> Bool {
        guard requireAccount(mutationDescription: "deleting events") else {
            return false
        }

        beginMutation()
        do {
            try await calendarClient.deleteEvent(calendarID: event.calendarID, eventID: event.id)
            removeEvent(id: event.id)
            endMutation(error: nil)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
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

    func setEnableVimKeybindings(_ isEnabled: Bool) {
        guard settings.enableVimKeybindings != isEnabled else { return }
        settings.enableVimKeybindings = isEnabled
        Task { await saveCurrentState() }
    }

    func setEnableGlobalHotkey(_ isEnabled: Bool) {
        guard settings.enableGlobalHotkey != isEnabled else { return }
        settings.enableGlobalHotkey = isEnabled
        Task { await saveCurrentState() }
    }

    func setShowDetailedMenuBar(_ isEnabled: Bool) {
        guard settings.showDetailedMenuBar != isEnabled else {
            return
        }
        settings.showDetailedMenuBar = isEnabled
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

        let snapshot = pendingMutations
        for mutation in snapshot {
            guard pendingMutations.contains(where: { $0.id == mutation.id }) else { continue }
            await replay(mutation)
        }
    }

    private func replay(_ mutation: PendingMutation) async {
        switch (mutation.resourceType, mutation.action) {
        case (.task, .create):
            await replayTaskCreate(mutation)
        case (.event, .create):
            await replayEventCreate(mutation)
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
            lastMutationError = "Sync will retry: \(error.localizedDescription)"
        } catch {
            if let payload = try? PendingMutationEncoder.decodeTaskCreate(mutation.payload) {
                removeTask(id: payload.localID)
            }
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Task couldn't be created: \(error.localizedDescription)"
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
                reminderMinutes: payload.reminderMinutes
            )
            removeEvent(id: payload.localID)
            upsert(created)
            pendingMutations.removeAll { $0.id == mutation.id }
            await saveCurrentState()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            lastMutationError = "Sync will retry: \(error.localizedDescription)"
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
            lastMutationError = "Connect Google before \(mutationDescription)."
            return false
        }
        return true
    }

    private func beginMutation() {
        isMutating = true
        lastMutationError = nil
    }

    private func endMutation(error: Error?) {
        isMutating = false
        if let error {
            lastMutationError = error.localizedDescription
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
        if let index = events.firstIndex(where: { $0.id == event.id }) {
            events[index] = event
        } else {
            events.append(event)
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
    }
}
