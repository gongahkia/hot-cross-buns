import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    private let authService: GoogleAuthService
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
        syncScheduler: SyncScheduler,
        cacheStore: LocalCacheStore,
        settings: AppSettings = .default
    ) {
        self.authService = authService
        self.syncScheduler = syncScheduler
        self.cacheStore = cacheStore
        self.settings = settings
    }

    static func bootstrap() -> AppModel {
        AppModel(
            authService: GoogleAuthService(),
            syncScheduler: SyncScheduler(),
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
    }

    func connectGoogleAccount() async {
        authState = .authenticating
        do {
            let account = try await authService.signIn()
            self.account = account
            authState = .signedIn(account)
            syncState = .idle
        } catch {
            authState = .failed(error.localizedDescription)
        }
    }

    func refreshNow() async {
        syncState = .syncing(startedAt: Date())
        do {
            let syncedState = try await syncScheduler.syncNow(mode: settings.syncMode)
            apply(syncedState)
            syncState = .synced(at: Date())
        } catch {
            syncState = .failed(message: error.localizedDescription)
        }
    }

    func updateSyncMode(_ mode: SyncMode) {
        settings.syncMode = mode
    }

    func toggleCalendar(_ calendarID: CalendarListMirror.ID) {
        guard let index = calendars.firstIndex(where: { $0.id == calendarID }) else {
            return
        }
        calendars[index].isSelected.toggle()
        rebuildSnapshots()
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

    private func rebuildSnapshots(referenceDate: Date = Date()) {
        taskSections = TaskListSectionSnapshot.build(taskLists: taskLists, tasks: tasks)
        todaySnapshot = TodaySnapshot.build(tasks: tasks, events: events, referenceDate: referenceDate)
        calendarSnapshot = CalendarSnapshot.build(calendars: calendars, events: events, referenceDate: referenceDate)
    }
}
