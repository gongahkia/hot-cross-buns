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

    private(set) var account: GoogleAccount?
    private(set) var authState: AuthState = .signedOut
    private(set) var syncState: SyncState = .idle
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
        settings: AppSettings = .default
    ) {
        self.authService = authService
        self.tasksClient = tasksClient
        self.calendarClient = calendarClient
        self.syncScheduler = syncScheduler
        self.cacheStore = cacheStore
        self.notificationScheduler = notificationScheduler
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

    func refreshNow() async {
        if case .syncing = syncState {
            return
        }

        guard account != nil else {
            syncState = .failed(message: "Connect Google before syncing.")
            return
        }

        syncState = .syncing(startedAt: Date())
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
        } catch {
            syncState = .failed(message: error.localizedDescription)
        }
    }

    func createTask(
        title: String,
        notes: String,
        dueDate: Date?,
        taskListID: TaskListMirror.ID
    ) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before creating tasks.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let task = try await tasksClient.insertTask(
                taskListID: taskListID,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
                dueDate: dueDate
            )
            upsert(task)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func createTaskList(title: String) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before creating task lists.")
            return false
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            syncState = .failed(message: "Task list title cannot be empty.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let taskList = try await tasksClient.insertTaskList(title: trimmedTitle)
            upsert(taskList)

            if settings.hasConfiguredTaskListSelection {
                settings.selectedTaskListIDs.insert(taskList.id)
            }

            syncState = .synced(at: Date())
            await saveCurrentState()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func updateTaskList(_ taskList: TaskListMirror, title: String) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before updating task lists.")
            return false
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            syncState = .failed(message: "Task list title cannot be empty.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let updatedTaskList = try await tasksClient.updateTaskList(
                taskListID: taskList.id,
                title: trimmedTitle
            )
            upsert(updatedTaskList)
            syncState = .synced(at: Date())
            await saveCurrentState()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func deleteTaskList(_ taskList: TaskListMirror) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before deleting task lists.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            try await tasksClient.deleteTaskList(taskListID: taskList.id)
            removeTaskList(id: taskList.id)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func updateTask(
        _ task: TaskMirror,
        title: String,
        notes: String,
        dueDate: Date?
    ) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before updating tasks.")
            return false
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.isEmpty == false else {
            syncState = .failed(message: "Task title cannot be empty.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let updatedTask = try await tasksClient.updateTask(
                taskListID: task.taskListID,
                taskID: task.id,
                title: trimmedTitle,
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines),
                dueDate: dueDate
            )
            upsert(updatedTask)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func setTaskCompleted(_ isCompleted: Bool, task: TaskMirror) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before updating tasks.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let updatedTask = try await tasksClient.setTaskCompleted(isCompleted, task: task)
            upsert(updatedTask)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func deleteTask(_ task: TaskMirror) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before deleting tasks.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            try await tasksClient.deleteTask(taskListID: task.taskListID, taskID: task.id)
            removeTask(id: task.id)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
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
        guard account != nil else {
            syncState = .failed(message: "Connect Google before creating events.")
            return false
        }

        guard isValidEventRange(startDate: startDate, endDate: endDate, isAllDay: isAllDay) else {
            syncState = .failed(message: isAllDay ? "All-day event end date cannot be before the start date." : "Event end time must be after the start time.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let event = try await calendarClient.insertEvent(
                calendarID: calendarID,
                summary: summary.trimmingCharacters(in: .whitespacesAndNewlines),
                details: details.trimmingCharacters(in: .whitespacesAndNewlines),
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes
            )
            upsert(event)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func updateEvent(
        _ event: CalendarEventMirror,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        reminderMinutes: Int?
    ) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before updating events.")
            return false
        }

        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedSummary.isEmpty == false else {
            syncState = .failed(message: "Event summary cannot be empty.")
            return false
        }

        guard isValidEventRange(startDate: startDate, endDate: endDate, isAllDay: isAllDay) else {
            syncState = .failed(message: isAllDay ? "All-day event end date cannot be before the start date." : "Event end time must be after the start time.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            let updatedEvent = try await calendarClient.updateEvent(
                calendarID: event.calendarID,
                eventID: event.id,
                summary: trimmedSummary,
                details: details.trimmingCharacters(in: .whitespacesAndNewlines),
                startDate: startDate,
                endDate: endDate,
                isAllDay: isAllDay,
                reminderMinutes: reminderMinutes
            )
            upsert(updatedEvent)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func deleteEvent(_ event: CalendarEventMirror) async -> Bool {
        guard account != nil else {
            syncState = .failed(message: "Connect Google before deleting events.")
            return false
        }

        syncState = .syncing(startedAt: Date())
        do {
            try await calendarClient.deleteEvent(calendarID: event.calendarID, eventID: event.id)
            removeEvent(id: event.id)
            syncState = .synced(at: Date())
            await saveCurrentState()
            await synchronizeLocalNotifications()
            return true
        } catch {
            syncState = .failed(message: error.localizedDescription)
            return false
        }
    }

    func updateSyncMode(_ mode: SyncMode) {
        settings.syncMode = mode
        Task {
            await saveCurrentState()
        }
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
