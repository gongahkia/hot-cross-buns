import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    private let authService: GoogleAuthService
    private let tasksClient: GoogleTasksClient
    private let syncScheduler: SyncScheduler
    private let cacheStore: LocalCacheStore

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
    var settings: AppSettings

    init(
        authService: GoogleAuthService,
        tasksClient: GoogleTasksClient,
        syncScheduler: SyncScheduler,
        cacheStore: LocalCacheStore,
        settings: AppSettings = .default
    ) {
        self.authService = authService
        self.tasksClient = tasksClient
        self.syncScheduler = syncScheduler
        self.cacheStore = cacheStore
        self.settings = settings
    }

    static func bootstrap() -> AppModel {
        let tokenProvider = GoogleSignInAccessTokenProvider()
        let transport = GoogleAPITransport(
            baseURL: URL(string: "https://www.googleapis.com")!,
            tokenProvider: tokenProvider
        )

        let tasksClient = GoogleTasksClient(transport: transport)
        return AppModel(
            authService: GoogleAuthService(),
            tasksClient: tasksClient,
            syncScheduler: SyncScheduler(
                tasksClient: tasksClient,
                calendarClient: GoogleCalendarClient(transport: transport)
            ),
            cacheStore: LocalCacheStore()
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

    func refreshNow() async {
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

    func toggleCalendar(_ calendarID: CalendarListMirror.ID) {
        guard let index = calendars.firstIndex(where: { $0.id == calendarID }) else {
            return
        }
        calendars[index].isSelected.toggle()
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

    private func currentCachedState() -> CachedAppState {
        CachedAppState(
            account: account,
            taskLists: taskLists,
            tasks: tasks,
            calendars: calendars,
            events: events,
            settings: settings
        )
    }

    private func saveCurrentState() async {
        await cacheStore.save(currentCachedState())
    }

    private func rebuildSnapshots(referenceDate: Date = Date()) {
        taskSections = TaskListSectionSnapshot.build(taskLists: taskLists, tasks: tasks)
        todaySnapshot = TodaySnapshot.build(tasks: tasks, events: events, referenceDate: referenceDate)
        calendarSnapshot = CalendarSnapshot.build(calendars: calendars, events: events, referenceDate: referenceDate)
    }
}
