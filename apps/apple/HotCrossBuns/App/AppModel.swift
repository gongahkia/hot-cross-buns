import Foundation
import Observation
import AppKit

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
    private let loginItemController: LoginItemController

    private(set) var account: GoogleAccount?
    // Default to .authenticating (not .signedOut) so the pre-loadInitialState
    // window shows a "connecting" state instead of a false-positive
    // "reconnect Google" banner. loadInitialState flips this to the real
    // state once the cached account + Keychain restore have run.
    private(set) var authState: AuthState = .authenticating
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
    // TODO: prune — dead after the Calendar/Tasks/Notes sidebar refactor.
    // QuickSwitcherView + MenuBarExtraScene still write this, but no view
    // reads it (the Tasks tab no longer exposes filter scopes). Delete the
    // field once those writers are updated to route to the appropriate
    // Kanban group-by mode, or dropped entirely.
    var pendingStoreFilterKey: String?
    // Populated on first launch-time check; DiagnosticsView surfaces.
    private(set) var keychainHealth: KeychainHealth = .unknown
    private(set) var customOAuthClientConfiguration: GoogleOAuthClientConfiguration?
    private(set) var opensAtLogin: Bool = false
    private(set) var loginItemError: String?
    // Days between this launch and the previous launch's wall-clock,
    // computed once in loadInitialState. Surfaced in AppStatusBanner
    // alongside the .syncing state so users see "5 days since last
    // open — fetching from Google" rather than a silent freeze on
    // first launch after a gap. Nil on the very first launch (no
    // prior timestamp on disk).
    private(set) var daysSinceLastLaunch: Int?
    private(set) var lastMutationError: String?
    private(set) var globalHotkeyRegistrationState: GlobalHotkeyRegistrationState = .disabled
    private(set) var syncFailureKind: SyncFailureKind?
    private(set) var taskLists: [TaskListMirror] = []
    private(set) var tasks: [TaskMirror] = []
    private(set) var calendars: [CalendarListMirror] = []
    private(set) var events: [CalendarEventMirror] = []
    // Pre-bucketed event IDs by calendar id. Recomputed in rebuildSnapshots so
    // each grid view can avoid the per-render `model.events.filter` over the
    // full event corpus (~17k+ at scale → ~3k once bucketed by typical
    // calendar selections, and lookup is O(1) per calendar). Cancelled
    // events are omitted to match the existing visibleEvents semantics. IDs
    // keep these indexes compact instead of retaining duplicate event mirrors.
    private(set) var eventsByCalendar: [CalendarListMirror.ID: [CalendarEventMirror.ID]] = [:]
    // Pre-bucketed event IDs keyed on startOfDay. Multi-day events appear in
    // every day they overlap. Cancelled events excluded. Grid views look up
    // O(1) per cell rather than re-filtering the full event corpus each
    // render. Stored as [TimeInterval] keys so Dictionary hashing stays
    // fast — comparing Date instances allocates formatter strings in some
    // Swift runtimes. Callers round to startOfDay before lookup.
    private(set) var eventsByDay: [TimeInterval: [CalendarEventMirror.ID]] = [:]
    // Pre-bucketed task IDs keyed on startOfDay(dueDate). Open, non-deleted
    // tasks only. Mirrors eventsByDay so grids skip the tasks.filter per
    // cell render without retaining duplicate task mirrors.
    private(set) var tasksByDueDate: [TimeInterval: [TaskMirror.ID]] = [:]
    private(set) var taskSections: [TaskListSectionSnapshot] = []
    private(set) var todaySnapshot: TodaySnapshot = .empty
    private(set) var calendarSnapshot: CalendarSnapshot = .empty
    // Cached during rebuildSnapshots so the sidebar badge doesn't have to
    // re-filter the full tasks array on every sidebar render.
    private(set) var openTaskCountForSidebar: Int = 0
    // Split badges for the post-refactor sidebar: dated tasks land in Tasks,
    // undated ones in Notes. Recomputed in rebuildSnapshots alongside the
    // combined count so the sidebar can render without re-filtering.
    private(set) var datedOpenTaskCount: Int = 0
    private(set) var undatedOpenTaskCount: Int = 0
    // Per-list completion stats for Store section headers — avoids O(n)
    // filtering per list on every header render.
    private(set) var taskListCompletionStats: [TaskListMirror.ID: TaskListCompletionStats] = [:]
    // Small title lookup maps shared by row/menu/search surfaces. These avoid
    // repeated first(where:) scans while keeping the large task/event mirrors
    // as the single source of truth.
    private(set) var taskListTitleByID: [TaskListMirror.ID: String] = [:]
    private(set) var calendarTitleByID: [CalendarListMirror.ID: String] = [:]
    // Monotonic counter bumped on every rebuildSnapshots pass — i.e. every
    // time the observable task/event/list/calendar state changes in a way a
    // downstream view might care about. Consumer views (MonthGrid, WeekGrid,
    // CommandPalette) compose this into their cache keys instead of the
    // previous count-only key; renames / reschedules / recolors that kept
    // the total count the same used to not bust those caches, producing
    // stale UI. Bumping here is the one-place invariant: if snapshots
    // rebuilt, the revision advances.
    private(set) var dataRevision: UInt64 = 0
    // O(1) ID-to-index lookups maintained by rebuildSnapshots. task(id:) / event(id:)
    // previously scanned the full arrays on every call, including inside
    // menus and body evaluations — observable lag for users with thousands
    // of tasks/events. The values are indexes rather than full mirrors so
    // lookup tables do not double-retain the largest data collections.
    private var taskIndexByID: [TaskMirror.ID: Int] = [:]
    private var eventIndexByID: [CalendarEventMirror.ID: Int] = [:]
    private var taskListIndexByID: [TaskListMirror.ID: Int] = [:]
    private(set) var syncCheckpoints: [SyncCheckpoint] = []
    private(set) var pendingMutations: [PendingMutation] = []
    private(set) var lastNotificationScheduleSummary: NotificationScheduleSummary?
    private(set) var recentlyCompletedTaskID: TaskMirror.ID?
    private(set) var undoable: UndoableAction?
    private var undoActionID = UUID()
    var undoActionToken: UUID { undoActionID }
    var settings: AppSettings
    // Rebuilt by rebuildDuplicateIndex whenever tasks or dismissedDuplicateGroups change. Cards and the task inspector read .isMember / .siblings to show the !! badge and duplicate banner.
    private(set) var duplicateIndex: DuplicateIndex = .empty

    // Past-cleanup coordinator. Assigned at the tail of init — @Observable
    // blocks lazy storage, so this is IUO wired up in the initializer once
    // `self` is complete enough to unown safely.
    private(set) var pastCleanupCoordinator: PastCleanupCoordinator!

    var lastSuccessfulSyncAt: Date? {
        syncCheckpoints.compactMap(\.lastSuccessfulSyncAt).max()
    }

    var isGoogleAuthConfigured: Bool {
        authService.isConfigured
    }

    init(
        authService: GoogleAuthService,
        tasksClient: GoogleTasksClient,
        calendarClient: GoogleCalendarClient,
        syncScheduler: SyncScheduler,
        cacheStore: LocalCacheStore,
        notificationScheduler: LocalNotificationScheduler = LocalNotificationScheduler(),
        spotlightIndexer: SpotlightIndexer = SpotlightIndexer(),
        loginItemController: LoginItemController = LoginItemController(),
        settings: AppSettings = .default
    ) {
        self.authService = authService
        self.tasksClient = tasksClient
        self.calendarClient = calendarClient
        self.syncScheduler = syncScheduler
        self.cacheStore = cacheStore
        self.notificationScheduler = notificationScheduler
        self.spotlightIndexer = spotlightIndexer
        self.loginItemController = loginItemController
        self.settings = settings
        self.customOAuthClientConfiguration = authService.customOAuthClientConfiguration
        self.opensAtLogin = loginItemController.isEnabled
        self.pastCleanupCoordinator = PastCleanupCoordinator(model: self)
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
        recordLaunchAndComputeDaysSinceLast()
        // Probe Keychain before anything that would touch GIDSignIn. If
        // the Keychain is locked/denied the restore will fail generically;
        // the probe lets us surface a specific reason in Diagnostics.
        keychainHealth = KeychainProbe.run()
        customOAuthClientConfiguration = authService.customOAuthClientConfiguration
        if keychainHealth == .denied {
            AppLogger.warn("keychain inaccessible at launch", category: .auth)
        }
        // §6.12 — if the cache is encrypted and we have a cached key in
        // Keychain, install it on the store before the first read.
        if let key = HCBCacheKeychain.load() {
            await cacheStore.setEncryptionKey(key)
        }
        let cachedState = await cacheStore.loadCachedState()
        apply(cachedState)
        // If we have a cached account, optimistically show signed-in while
        // restoreGoogleSession runs. If not, stay in .authenticating — don't
        // flip to .signedOut prematurely; restoreGoogleSession will do that
        // only if the Keychain actually has no prior session.
        if let account = cachedState.account {
            authState = .signedIn(account)
        }
        if let warning = await cacheStore.lastLoadWarning {
            lastMutationError = warning
        }
        await synchronizeLocalNotifications()
        // Arm the daily midnight tick for past-cleanup. No-op until the
        // user has enabled a deletion behavior AND acknowledged the
        // blast-radius modal; the coordinator filters on read.
        pastCleanupCoordinator.scheduleDailyTick()
    }

    // Reads the prior wall-clock launch time from UserDefaults, computes the
    // gap in whole days, and stamps "now". Nil result on first launch (no
    // prior timestamp). Surfaced by AppStatusBanner alongside .syncing so a
    // long-absence cold launch reads as "5 days since last open — fetching"
    // rather than a silent multi-second freeze.
    private func recordLaunchAndComputeDaysSinceLast() {
        let key = "hcb.lastSeenAt"
        let defaults = UserDefaults.standard
        let now = Date()
        if let stored = defaults.object(forKey: key) as? Date {
            let days = Calendar.current.dateComponents([.day], from: stored, to: now).day ?? 0
            daysSinceLastLaunch = max(0, days)
        }
        defaults.set(now, forKey: key)
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
            // Force-flush: account state must hit disk before any sync run.
            await saveCurrentState()
        } catch {
            if GoogleAuthService.isUserCancellation(error) {
                authState = .cancelled("Sign-in was cancelled. Tap Connect Google to try again.")
            } else {
                authState = .failed(error.localizedDescription)
            }
        }
    }

    func saveCustomOAuthClientConfiguration(clientID: String, clientSecret: String?) {
        do {
            let saved = try authService.saveCustomOAuthClientConfiguration(clientID: clientID, clientSecret: clientSecret)
            customOAuthClientConfiguration = saved
            if account?.authProvider == .customDesktopOAuth {
                account = nil
                authState = .signedOut
                syncState = .idle
                Task { await saveCurrentState() }
            }
        } catch {
            authState = .failed(error.localizedDescription)
        }
    }

    func clearCustomOAuthClientConfiguration() {
        authService.clearCustomOAuthClientConfiguration()
        customOAuthClientConfiguration = nil
        if account?.authProvider == .customDesktopOAuth {
            account = nil
            authState = .signedOut
            syncState = .idle
            Task { await saveCurrentState() }
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
            // Don't surface this as a sync .failed state — on cold launch
            // refreshNow runs before auth restore completes, which would
            // flash a "Couldn't reach Google" banner even when the user
            // is correctly signed in. authState .signedOut already surfaces
            // the legitimate "not connected" case via AppStatusBanner.
            return .skipped
        }

        let started = Date()
        AppLogger.info("refresh start", category: .sync, metadata: ["mode": settings.syncMode.rawValue])
        syncState = .syncing(startedAt: started)
        syncFailureKind = nil
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
            syncFailureKind = nil
            // Force-flush: completed sync state must hit disk so a crash
            // before the next mutation doesn't lose the freshly-fetched
            // events. (replayPendingMutations runs again next launch
            // anyway but unnecessary refetch is wasteful.)
            await saveCurrentState()
            await synchronizeLocalNotifications()
            let duration = Int(Date().timeIntervalSince(started) * 1000)
            AppLogger.info("refresh succeeded", category: .sync, metadata: [
                "ms": String(duration),
                "tasks": String(tasks.count),
                "events": String(events.count)
            ])
            // Past-cleanup runs silently after each successful sync once
            // the user has acknowledged the blast-radius modal. Fires
            // delete calls serially so quota + audit log stay orderly.
            _ = await pastCleanupCoordinator.runSilentSweepIfAcknowledged()
            return .succeeded
        } catch {
            syncFailureKind = SyncFailureKind.classify(error)
            var httpStatus: String? = nil
            if case let GoogleAPIError.httpStatus(status, _) = error {
                httpStatus = String(status)
                if status == 401 || status == 403 {
                    authState = .failed(error.localizedDescription)
                }
            }
            if let tokenError = error as? GoogleTokenRefreshError, tokenError.requiresReconnect {
                authState = .failed(tokenError.localizedDescription)
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
        await createTaskInternal(
            title: title,
            notes: notes,
            dueDate: dueDate,
            taskListID: taskListID,
            parentID: parentID,
            recordAs: nil // default to .taskCreate below
        )
    }

    @discardableResult
    private func createTaskInternal(
        title: String,
        notes: String,
        dueDate: Date?,
        taskListID: TaskListMirror.ID,
        parentID: TaskMirror.ID?,
        recordAs override: ((TaskMirror) -> UndoableAction)?
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
            scheduleCacheSave()
        } catch {
            removeTask(id: localID)
            lastMutationError = "Could not queue task for sync: \(error.localizedDescription)"
            return false
        }

        let undoAction = override?(optimisticTask) ?? .taskCreate(snapshot: optimisticTask)
        recordUndo(undoAction)
        Task { await replayPendingMutations() }
        return true
    }

    func duplicateTask(_ task: TaskMirror) async -> Bool {
        await duplicateTask(task, dueDate: task.dueDate)
    }

    func duplicateTask(_ task: TaskMirror, dueDate: Date?) async -> Bool {
        let sourceTitle = task.title
        return await createTaskInternal(
            title: task.title,
            notes: task.notes,
            dueDate: dueDate,
            taskListID: task.taskListID,
            parentID: task.parentID,
            recordAs: { optimistic in .taskDuplicate(newSnapshot: optimistic, sourceTitle: sourceTitle) }
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
            let fromListTitle = taskLists.first(where: { $0.id == task.taskListID })?.title ?? task.taskListID
            let toListTitle = taskLists.first(where: { $0.id == toTaskListID })?.title ?? toTaskListID
            recordUndo(.taskMove(
                taskID: finalTask.id,
                fromListID: task.taskListID,
                toListID: toTaskListID,
                title: task.title,
                fromListTitle: fromListTitle,
                toListTitle: toListTitle
            ))
            endMutation(error: nil)
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
            scheduleCacheSave()
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
                scheduleCacheSave()
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
        // Record the undoable toast NOW, not after the API + notification-sync
        // round-trip. Previously users saw a 15-20s delay between clicking
        // Complete and the toast appearing because recordUndo sat after
        // `await synchronizeLocalNotifications()`. The snapshot (originalTask)
        // is captured pre-await so rollback on terminal failure still works;
        // a stale undo entry from a reverted failure is harmless (the undo
        // path idempotently re-sets the status).
        if isCompleted {
            recentlyCompletedTaskID = optimistic.id
        } else if recentlyCompletedTaskID == optimistic.id {
            recentlyCompletedTaskID = nil
        }
        recordUndo(.taskCompletion(
            taskID: optimistic.id,
            priorCompleted: originalTask.isCompleted,
            title: optimistic.title
        ))
        if isCompleted {
            CompletionSoundPlayer.play(.taskCompleted, settings: settings)
        }

        beginMutation()
        do {
            let updatedTask = try await tasksClient.setTaskCompleted(isCompleted, task: task)
            upsert(updatedTask)
            endMutation(error: nil)
            scheduleCacheSave()
            await synchronizeLocalNotifications()
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
                scheduleCacheSave()
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
        let (kind, resourceID, summary, metadata) = Self.auditTuple(for: action)
        let priorJSON = Self.priorSnapshotJSON(for: action)
        let postJSON = Self.postSnapshotJSON(for: action)
        // Informational-only actions (sync diffs, bulk summaries) should not
        // hijack the 6-second undo toast — their performUndo is a no-op, so
        // users would see a dead "Undo" button after every 30s poll tick.
        // Write them straight to the audit log instead.
        switch action {
        case .syncPulled, .bulkAction, .clipboardOp:
            Task { await MutationAuditLog.shared.record(kind: kind, resourceID: resourceID, summary: summary, metadata: metadata, priorSnapshotJSON: priorJSON, postSnapshotJSON: postJSON) }
            return
        default:
            break
        }
        undoable = action
        undoActionID = UUID()
        // Record a permanent audit entry in parallel — the undo window
        // is short (~6s) but the audit log is a forever record of what
        // the user did, useful when reconstructing "when did I mark
        // that task done?" months later.
        Task { await MutationAuditLog.shared.record(kind: kind, resourceID: resourceID, summary: summary, metadata: metadata, priorSnapshotJSON: priorJSON, postSnapshotJSON: postJSON) }
    }

    // JSON-encode the pre-state so the history window can offer "Copy
    // snapshot" on ops that Google's API cannot truly reverse (a hard
    // delete past the undo-stack TTL, a move that reassigned IDs, etc.).
    // Returns nil when there's no meaningful prior state (creates).
    private static func priorSnapshotJSON(for action: UndoableAction) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        switch action {
        case .taskDelete(let snap), .taskEdit(let snap), .taskRestore(let snap):
            return Self.encode(snap, using: encoder)
        case .eventDelete(let snap), .eventEdit(let snap), .eventRestore(let snap), .eventDismissed(let snap):
            return Self.encode(snap, using: encoder)
        default:
            return nil
        }
    }

    // JSON-encode the post-state for ops where the "new" resource is the
    // interesting thing to keep (creates, duplicates). Other cases are
    // either unchanged-from-prior (edits reuse prior) or reversible without
    // a snapshot (completions).
    private static func postSnapshotJSON(for action: UndoableAction) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        switch action {
        case .taskCreate(let snap):
            return Self.encode(snap, using: encoder)
        case .taskDuplicate(let snap, _):
            return Self.encode(snap, using: encoder)
        case .eventCreate(let snap):
            return Self.encode(snap, using: encoder)
        default:
            return nil
        }
    }

    private static func encode<T: Encodable>(_ value: T, using encoder: JSONEncoder) -> String? {
        guard let data = try? encoder.encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
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
        case .taskCreate(let snap):
            return ("task.create", snap.id, snap.title, ["list": snap.taskListID])
        case .taskDuplicate(let snap, let sourceTitle):
            return ("task.duplicate", snap.id, snap.title, ["list": snap.taskListID, "sourceTitle": sourceTitle])
        case .taskMove(let id, let fromID, let toID, let title, let fromTitle, let toTitle):
            return ("task.move", id, title, [
                "fromListID": fromID,
                "toListID": toID,
                "fromListTitle": fromTitle,
                "toListTitle": toTitle
            ])
        case .eventCreate(let snap):
            return ("event.create", snap.id, snap.summary, ["calendar": snap.calendarID])
        case .eventDismissed(let snap):
            return ("event.dismiss", snap.id, snap.summary, ["calendar": snap.calendarID])
        case .clipboardOp(let kind, let resourceID, let title):
            return ("clipboard.\(kind)", resourceID, title, [:])
        case .taskRestore(let snap):
            return ("task.restore", snap.id, snap.title, ["list": snap.taskListID])
        case .eventRestore(let snap):
            return ("event.restore", snap.id, snap.summary, ["calendar": snap.calendarID])
        case .bulkAction(let kind, let count, let firstTitle):
            return ("bulk.\(kind)", "", firstTitle, ["count": String(count)])
        case .syncPulled(let kind, let count):
            return ("sync.\(kind)", "", "sync", ["count": String(count)])
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
        scheduleCacheSave()
        return true
    }

    func clearAllPendingMutations() {
        guard pendingMutations.isEmpty == false else { return }
        pendingMutations = []
        scheduleCacheSave()
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
        case .taskCreate(let snap):
            // undo create = delete the created task
            guard let task = task(id: snap.id) else { return }
            _ = await deleteTask(task)
        case .taskDuplicate(let snap, _):
            // undo duplicate = delete the new copy
            guard let task = task(id: snap.id) else { return }
            _ = await deleteTask(task)
        case .taskMove(let id, let fromID, _, _, _, _):
            // undo move = move back to fromListID. id is the finalTask.id from
            // moveTaskToList (the new Google-assigned ID on the destination
            // list). If the mirror no longer contains it (user deleted it,
            // sync dropped it), silently bail — better a no-op than moving
            // an unrelated task.
            guard let task = task(id: id) else { return }
            _ = await moveTaskToList(task, toTaskListID: fromID)
        case .eventCreate(let snap):
            guard let event = event(id: snap.id) else { return }
            _ = await deleteEvent(event)
        case .eventDismissed(let snap):
            // same inverse as eventDelete — Google has no "uncomplete" so the
            // event is recreated from the snapshot.
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
        case .clipboardOp, .bulkAction, .syncPulled, .taskRestore, .eventRestore:
            // not invertible from the short-TTL undo toast; history window handles these via snapshot copy
            return
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
            scheduleCacheSave()
            await synchronizeLocalNotifications()
            return true
        }

        let originalTask = task
        removeTask(id: task.id)

        beginMutation()
        do {
            try await tasksClient.deleteTask(taskListID: task.taskListID, taskID: task.id, ifMatch: task.etag)
            endMutation(error: nil)
            scheduleCacheSave()
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
                scheduleCacheSave()
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
        colorId: String? = nil,
        hcbTaskID: String? = nil
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
            colorId: colorId,
            hcbTaskID: hcbTaskID
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
                colorId: colorId,
                hcbTaskID: hcbTaskID
            )
            let mutation = try PendingMutation.eventCreate(payload: payload)
            pendingMutations.append(mutation)
            scheduleCacheSave()
        } catch {
            removeEvent(id: localID)
            lastMutationError = "Could not queue event for sync: \(error.localizedDescription)"
            return false
        }

        recordUndo(.eventCreate(snapshot: optimisticEvent))
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
        colorId: String? = nil,
        hcbTaskID: String? = nil
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

            // Preserve any existing hcb backlink on the event unless the caller
            // explicitly supplied a new one. Without this, every update would
            // clear extendedProperties.private.hcbTaskID (Google Calendar
            // treats an omitted field on PATCH as "leave as-is" for the outer
            // bag — but we pass a dict, so we need to echo it back ourselves).
            let effectiveHCBTaskID = hcbTaskID ?? event.hcbTaskID

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
                hcbTaskID: effectiveHCBTaskID,
                ifMatch: scope == .allInSeries ? nil : eventToUpdate.etag
            )
            if calendarID != event.calendarID {
                removeEvent(id: event.id)
            }
            upsert(updatedEvent)
            endMutation(error: nil)
            scheduleCacheSave()
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
                colorId: colorId,
                hcbTaskID: hcbTaskID ?? event.hcbTaskID
            )
            if let mutation = try? PendingMutation.eventUpdate(payload: payload) {
                pendingMutations.append(mutation)
                scheduleCacheSave()
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

    // Deletes the event from Google (since Calendar has no completion state)
    // but records the undoable as .eventDismissed so the user can distinguish
    // "marked done" from "deleted" in the history log + undo toast. Always
    // .thisOccurrence scope — dismissing a recurring master doesn't make
    // sense (you finish individual occurrences, not the whole series).
    func dismissEvent(_ event: CalendarEventMirror) async -> Bool {
        guard requireAccount(mutationDescription: "marking events done") else {
            return false
        }
        // Pending creates still in the outbox — retract locally, no Google call.
        if OptimisticID.isPending(event.id) {
            pendingMutations.removeAll { mutation in
                mutation.resourceType == .event
                    && mutation.action == .create
                    && mutation.resourceID == event.id
            }
            removeEvent(id: event.id)
            lastMutationError = nil
            scheduleCacheSave()
            await synchronizeLocalNotifications()
            recordUndo(.eventDismissed(snapshot: event))
            return true
        }

        let originalEvent = event
        removeEvent(id: event.id)
        // Record the undoable immediately (optimistic) so the toast fires
        // without waiting on Google's 200.
        recordUndo(.eventDismissed(snapshot: originalEvent))
        CompletionSoundPlayer.play(.eventDismissed, settings: settings)
        beginMutation()
        do {
            let targetID = event.id
            try await calendarClient.deleteEvent(calendarID: event.calendarID, eventID: targetID, ifMatch: event.etag)
            endMutation(error: nil)
            scheduleCacheSave()
            await synchronizeLocalNotifications()
            return true
        } catch let error as GoogleAPIError where error.isTransient {
            // Queue for retry — same pattern as deleteEvent.
            let payload = PendingEventDeletePayload(
                calendarID: event.calendarID,
                eventID: event.id,
                etagSnapshot: event.etag
            )
            if let mutation = try? PendingMutation.eventDelete(payload: payload) {
                pendingMutations.append(mutation)
                scheduleCacheSave()
                await synchronizeLocalNotifications()
                endMutation(error: nil)
                Task { await replayPendingMutations() }
                return true
            }
            upsert(originalEvent)
            endMutation(error: error)
            return false
        } catch {
            upsert(originalEvent)
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
            scheduleCacheSave()
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
                scheduleRebuildSnapshots()
                endMutation(error: nil)
                scheduleCacheSave()
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
                scheduleRebuildSnapshots()
            }
            endMutation(error: nil)
            scheduleCacheSave()
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
                scheduleCacheSave()
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
            scheduleCacheSave()
        }
    }

    func setShowMenuBarExtra(_ isEnabled: Bool) {
        guard settings.showMenuBarExtra != isEnabled else {
            return
        }
        settings.showMenuBarExtra = isEnabled
        scheduleCacheSave()
    }

    func setShowDockBadge(_ isEnabled: Bool) {
        guard settings.showDockBadge != isEnabled else {
            return
        }
        settings.showDockBadge = isEnabled
        scheduleCacheSave()
    }

    func setShowMenuBarBadge(_ isEnabled: Bool) {
        guard settings.showMenuBarBadge != isEnabled else {
            return
        }
        settings.showMenuBarBadge = isEnabled
        scheduleCacheSave()
    }

    func setEnableGlobalHotkey(_ isEnabled: Bool) {
        guard settings.enableGlobalHotkey != isEnabled else { return }
        settings.enableGlobalHotkey = isEnabled
        scheduleCacheSave()
    }

    func setGlobalHotkeyBinding(_ binding: GlobalHotkeyBinding) {
        guard settings.globalHotkeyBinding != binding else { return }
        settings.globalHotkeyBinding = binding
        scheduleCacheSave()
    }

    func setGlobalHotkeyRegistrationState(_ state: GlobalHotkeyRegistrationState) {
        globalHotkeyRegistrationState = state
    }

    // History-log + duplicate-detection setters. Kept clustered for discoverability.

    func setHistoryVisibleLimit(_ limit: Int) {
        let clamped = max(1, min(MutationAuditLog.absoluteCeiling, limit))
        guard settings.historyVisibleLimit != clamped else { return }
        settings.historyVisibleLimit = clamped
        scheduleCacheSave()
    }

    func setHistoryStorageCap(_ cap: Int) {
        let clamped = max(1, min(MutationAuditLog.absoluteCeiling, cap))
        guard settings.historyStorageCap != clamped else { return }
        settings.historyStorageCap = clamped
        scheduleCacheSave()
        Task { await MutationAuditLog.shared.setRetentionLimit(clamped) }
    }

    func setHistoryCategoryEnabled(_ category: String, enabled: Bool) {
        var set = settings.historyCategoryFilters
        if enabled { set.insert(category) } else { set.remove(category) }
        guard settings.historyCategoryFilters != set else { return }
        settings.historyCategoryFilters = set
        scheduleCacheSave()
    }

    func dismissDuplicateGroup(_ groupKey: String) {
        var set = settings.dismissedDuplicateGroups
        set.insert(groupKey)
        guard settings.dismissedDuplicateGroups != set else { return }
        settings.dismissedDuplicateGroups = set
        scheduleCacheSave()
        rebuildDuplicateIndex()
    }

    func dismissDuplicateGroupContaining(_ taskID: TaskMirror.ID) {
        guard let key = duplicateIndex.groupKey(for: taskID) else { return }
        dismissDuplicateGroup(key)
    }

    func restoreDuplicateGroup(_ groupKey: String) {
        var set = settings.dismissedDuplicateGroups
        set.remove(groupKey)
        guard settings.dismissedDuplicateGroups != set else { return }
        settings.dismissedDuplicateGroups = set
        scheduleCacheSave()
        rebuildDuplicateIndex()
    }

    func clearAllDuplicateDismissals() {
        guard settings.dismissedDuplicateGroups.isEmpty == false else { return }
        settings.dismissedDuplicateGroups = []
        scheduleCacheSave()
        rebuildDuplicateIndex()
    }

    // §7.02 — event retention window. Clamped to a sane [0, 3650] range so a
    // corrupt cache can't request a 100-year cutoff. 0 = keep-forever.
    func setEventRetentionDaysBack(_ days: Int) {
        let clamped = max(0, min(days, 3650))
        guard settings.eventRetentionDaysBack != clamped else { return }
        settings.eventRetentionDaysBack = clamped
        // Apply in-memory immediately so users see the cache shrink without
        // waiting for the next sync tick. Pruning mirrors the SyncScheduler
        // logic — same cutoff semantics, same preserve-recent-edits carveout.
        if clamped > 0 {
            let cutoff = Calendar.current.date(byAdding: .day, value: -clamped, to: Date())
            if let cutoff {
                events = events.filter { event in
                    if OptimisticID.isPending(event.id) { return true }
                    if event.endDate >= cutoff { return true }
                    if let updatedAt = event.updatedAt, updatedAt >= cutoff { return true }
                    return false
                }
            }
        }
        scheduleCacheSave()
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
        scheduleCacheSave()
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
        scheduleCacheSave()
    }

    // §6.13 — Task templates. Stored locally only; never written to Google.
    func upsertTaskTemplate(_ template: TaskTemplate) {
        if let index = settings.taskTemplates.firstIndex(where: { $0.id == template.id }) {
            settings.taskTemplates[index] = template
        } else {
            settings.taskTemplates.append(template)
        }
        scheduleCacheSave()
    }

    func deleteTaskTemplate(_ id: UUID) {
        settings.taskTemplates.removeAll { $0.id == id }
        scheduleCacheSave()
    }

    // Instantiates a task template: expands every field with the given
    // variable context, then creates a real Google Task via the existing
    // createTask path. Returns true on success. `prompts` maps the label of
    // each {{prompt:Label}} placeholder to the user's typed answer.
    @discardableResult
    func instantiateTaskTemplate(_ template: TaskTemplate, prompts: [String: String] = [:]) async -> Bool {
        let ctx = HCBTemplateContext(
            now: Date(),
            calendar: .current,
            clipboard: NSPasteboard.general.string(forType: .string),
            prompts: prompts
        )
        let title = HCBTemplateExpander.expand(template.title, context: ctx)
            .replacingOccurrences(of: HCBTemplateExpander.cursorSentinel, with: "")
        let notes = HCBTemplateExpander.expand(template.notes, context: ctx)
            .replacingOccurrences(of: HCBTemplateExpander.cursorSentinel, with: "")
        let dueString = HCBTemplateExpander.expand(template.due, context: ctx)
            .replacingOccurrences(of: HCBTemplateExpander.cursorSentinel, with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let listRef = HCBTemplateExpander.expand(template.listIdOrTitle, context: ctx)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let dueDate: Date? = {
            guard dueString.isEmpty == false else { return nil }
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            return f.date(from: dueString).map { Calendar.current.startOfDay(for: $0) }
        }()

        let resolvedListID: String? = {
            if listRef.isEmpty { return taskLists.first?.id }
            if let exact = taskLists.first(where: { $0.id == listRef }) { return exact.id }
            return taskLists.first(where: { $0.title.localizedCaseInsensitiveCompare(listRef) == .orderedSame })?.id
        }()

        guard let listID = resolvedListID else {
            lastMutationError = "No task list available for template '\(template.name)'."
            return false
        }

        return await createTask(
            title: title,
            notes: notes,
            dueDate: dueDate,
            taskListID: listID
        )
    }

    // §6.12 — Cache encryption lifecycle. Enabling derives a key from the
    // user's passphrase + a fresh salt, encrypts the current cache, and
    // persists the key in Keychain so future launches don't re-prompt.
    // Returns true on success; false + sets lastMutationError on failure.
    @discardableResult
    func enableCacheEncryption(passphrase: String) async -> Bool {
        let trimmed = passphrase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            lastMutationError = "Passphrase is empty."
            return false
        }
        let salt = await cacheStore.ensureSalt()
        do {
            let key = try HCBCacheCrypto.deriveKey(passphrase: trimmed, salt: salt)
            try HCBCacheKeychain.save(key)
            await cacheStore.setEncryptionKey(key)
            settings.cacheEncryptionEnabled = true
            scheduleCacheSave() // triggers a save that will now encrypt
            return true
        } catch {
            lastMutationError = "Could not enable encryption: \(error)"
            HCBCacheKeychain.clear()
            await cacheStore.setEncryptionKey(nil)
            return false
        }
    }

    // Clears encryption, rewriting the cache as plaintext and removing the
    // salt sidecar so no half-encrypted state lingers. Requires the current
    // passphrase so a stolen laptop can't disable encryption by just flipping
    // the Settings toggle — the verify step confirms the caller knows the key.
    @discardableResult
    func disableCacheEncryption(currentPassphrase: String) async -> Bool {
        guard await verifyCachePassphrase(currentPassphrase) else {
            lastMutationError = "Passphrase does not match."
            return false
        }
        do {
            try await cacheStore.dropEncryption()
        } catch {
            lastMutationError = "Could not rewrite cache as plaintext: \(error)"
            return false
        }
        HCBCacheKeychain.clear()
        settings.cacheEncryptionEnabled = false
        await saveCurrentState()
        return true
    }

    // Verifies a passphrase without mutating anything on disk. Used by the
    // disable-encryption flow and the change-passphrase flow.
    func verifyCachePassphrase(_ passphrase: String) async -> Bool {
        guard let salt = await cacheStore.currentSalt() else { return false }
        guard let derived = try? HCBCacheCrypto.deriveKey(passphrase: passphrase, salt: salt) else { return false }
        guard let cached = HCBCacheKeychain.load() else {
            // Keychain was cleared but cache is still encrypted — accept a
            // correct re-derivation by attempting a decrypt via the loaded
            // envelope. The caller should treat true here as "this passphrase
            // would unlock the cache if set."
            return true // best-effort
        }
        return derived.withUnsafeBytes { d in
            cached.withUnsafeBytes { c in
                d.count == c.count && memcmp(d.baseAddress, c.baseAddress, d.count) == 0
            }
        }
    }

    // Re-keys the cache: verifies the current passphrase, derives a fresh
    // key from the new one with a fresh salt, re-encrypts. Fails closed:
    // on any error we leave the old key + cache intact.
    @discardableResult
    func changeCachePassphrase(from current: String, to next: String) async -> Bool {
        guard await verifyCachePassphrase(current) else {
            lastMutationError = "Current passphrase does not match."
            return false
        }
        let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            lastMutationError = "New passphrase is empty."
            return false
        }
        // Fresh salt on re-key — rotates the KDF input alongside the passphrase.
        let newSalt = HCBCacheCrypto.randomSalt()
        do {
            let newKey = try HCBCacheCrypto.deriveKey(passphrase: trimmed, salt: newSalt)
            // Write the new salt first so the next encrypt picks it up. The
            // existing salt is overwritten atomically below via ensureSalt.
            if let saltURL = await cacheStore.saltFileURL() {
                try? FileManager.default.createDirectory(at: saltURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try newSalt.write(to: saltURL, options: [.atomic])
            }
            try HCBCacheKeychain.save(newKey)
            await cacheStore.setEncryptionKey(newKey)
            scheduleCacheSave() // re-encrypt with the new key
            return true
        } catch {
            lastMutationError = "Could not change passphrase: \(error)"
            return false
        }
    }

    // Updates a per-surface font override (§6.11). Passing `.empty` clears
    // the override so the surface falls back to the global Appearance font.
    func setPerSurfaceFont(_ surface: HCBSurface, override: HCBSurfaceFontOverride) {
        var next = settings.perSurfaceFontOverrides
        if override.isEmpty {
            next.removeValue(forKey: surface.rawValue)
        } else {
            next[surface.rawValue] = override
        }
        guard next != settings.perSurfaceFontOverrides else { return }
        settings.perSurfaceFontOverrides = next
        scheduleCacheSave()
    }

    // TODO: prune — dead after the Calendar/Tasks/Notes sidebar refactor.
    // No caller remains; StoreViewMode + hiddenStoreViewModes follow. Safe
    // to delete alongside the enum file and the AppSettings field.
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
        scheduleCacheSave()
    }

    func updateSettings(_ next: AppSettings) {
        guard settings != next else { return }
        settings = next
        scheduleCacheSave()
    }

    func settingsExportBundle() -> SettingsTransferBundle {
        SettingsTransferBundle(settings: settings)
    }

    func previewSettingsImport(_ bundle: SettingsTransferBundle) -> SettingsImportPreview {
        let next = settingsForImport(bundle.settings)
        return SettingsImportPreview(
            changeCount: settingsImportChangeCount(from: settings, to: next),
            summaries: settingsImportSummaries(from: settings, to: next),
            excludedFields: bundle.excludedFields
        )
    }

    func applySettingsImport(_ bundle: SettingsTransferBundle) {
        let next = settingsForImport(bundle.settings)
        guard settings != next else { return }
        settings = next
        rebuildSnapshots()
        scheduleCacheSave()
    }

    private func settingsForImport(_ imported: AppSettings) -> AppSettings {
        var next = imported
        // Encryption enablement is tied to this Mac's Keychain key. Importing
        // the flag without the key would leave the UI claiming encryption is
        // active while the cache store cannot encrypt/decrypt with that key.
        next.cacheEncryptionEnabled = settings.cacheEncryptionEnabled
        return next
    }

    private func settingsImportChangeCount(from current: AppSettings, to next: AppSettings) -> Int {
        [
            current.syncMode != next.syncMode,
            current.selectedCalendarIDs != next.selectedCalendarIDs,
            current.selectedTaskListIDs != next.selectedTaskListIDs,
            current.shortcutOverrides != next.shortcutOverrides,
            current.hiddenSidebarItems != next.hiddenSidebarItems,
            current.hiddenCalendarViewModes != next.hiddenCalendarViewModes,
            current.customFilters != next.customFilters,
            current.taskTemplates != next.taskTemplates,
            current.eventTemplates != next.eventTemplates,
            current.colorSchemeID != next.colorSchemeID,
            current.uiLayoutScale != next.uiLayoutScale,
            current.uiTextSizePoints != next.uiTextSizePoints,
            current.uiFontName != next.uiFontName,
            current.perSurfaceFontOverrides != next.perSurfaceFontOverrides,
            current.menuBarStyle != next.menuBarStyle,
            current.showMenuBarExtra != next.showMenuBarExtra,
            current.showMenuBarBadge != next.showMenuBarBadge,
            current.showDockBadge != next.showDockBadge,
            current.enableGlobalHotkey != next.enableGlobalHotkey,
            current.globalHotkeyBinding != next.globalHotkeyBinding,
            current.enableLocalNotifications != next.enableLocalNotifications,
            current.pastEventBehavior != next.pastEventBehavior,
            current.overdueTaskBehavior != next.overdueTaskBehavior,
            current.completedTaskBehavior != next.completedTaskBehavior,
            current.showCompletedItemsInCalendar != next.showCompletedItemsInCalendar,
            current.historyVisibleLimit != next.historyVisibleLimit,
            current.historyStorageCap != next.historyStorageCap
        ].filter { $0 }.count
    }

    private func settingsImportSummaries(from current: AppSettings, to next: AppSettings) -> [String] {
        var summaries: [String] = []

        if current.colorSchemeID != next.colorSchemeID
            || current.uiLayoutScale != next.uiLayoutScale
            || current.uiTextSizePoints != next.uiTextSizePoints
            || current.uiFontName != next.uiFontName
            || current.perSurfaceFontOverrides != next.perSurfaceFontOverrides {
            summaries.append("Appearance, font, layout, or theme preferences will change.")
        }
        if current.shortcutOverrides != next.shortcutOverrides
            || current.enableGlobalHotkey != next.enableGlobalHotkey
            || current.globalHotkeyBinding != next.globalHotkeyBinding {
            summaries.append("Keyboard shortcut and global hotkey settings will change.")
        }
        if current.syncMode != next.syncMode
            || current.selectedCalendarIDs != next.selectedCalendarIDs
            || current.selectedTaskListIDs != next.selectedTaskListIDs
            || current.hasConfiguredCalendarSelection != next.hasConfiguredCalendarSelection
            || current.hasConfiguredTaskListSelection != next.hasConfiguredTaskListSelection {
            summaries.append("Sync mode, calendar visibility, or task-list visibility will change.")
        }
        if current.customFilters != next.customFilters {
            summaries.append("Custom filters will change from \(current.customFilters.count) to \(next.customFilters.count).")
        }
        if current.taskTemplates != next.taskTemplates || current.eventTemplates != next.eventTemplates {
            summaries.append("Templates will change from \(current.taskTemplates.count + current.eventTemplates.count) to \(next.taskTemplates.count + next.eventTemplates.count).")
        }
        if current.menuBarStyle != next.menuBarStyle
            || current.showMenuBarExtra != next.showMenuBarExtra
            || current.showMenuBarBadge != next.showMenuBarBadge
            || current.showDockBadge != next.showDockBadge
            || current.hiddenSidebarItems != next.hiddenSidebarItems
            || current.hiddenCalendarViewModes != next.hiddenCalendarViewModes {
            summaries.append("Menu bar, Dock badge, sidebar, or calendar view visibility will change.")
        }
        if current.enableLocalNotifications != next.enableLocalNotifications
            || current.enableTaskCompletionSound != next.enableTaskCompletionSound
            || current.enableEventCompletionSound != next.enableEventCompletionSound
            || current.taskCompletionSoundChoice != next.taskCompletionSoundChoice
            || current.eventCompletionSoundChoice != next.eventCompletionSoundChoice {
            summaries.append("Reminder and completion sound preferences will change.")
        }
        if current.pastEventBehavior != next.pastEventBehavior
            || current.overdueTaskBehavior != next.overdueTaskBehavior
            || current.completedTaskBehavior != next.completedTaskBehavior
            || current.showCompletedItemsInCalendar != next.showCompletedItemsInCalendar {
            summaries.append("Calendar cleanup and completed-item visibility preferences will change.")
        }
        if current.historyVisibleLimit != next.historyVisibleLimit
            || current.historyStorageCap != next.historyStorageCap
            || current.historyCategoryFilters != next.historyCategoryFilters {
            summaries.append("History window preferences will change.")
        }

        return summaries
    }

    func refreshOpenAtLoginStatus() {
        opensAtLogin = loginItemController.isEnabled
    }

    func setOpenAtLogin(_ isEnabled: Bool) {
        loginItemError = nil
        do {
            try loginItemController.setEnabled(isEnabled)
            opensAtLogin = loginItemController.isEnabled
        } catch {
            opensAtLogin = loginItemController.isEnabled
            loginItemError = error.localizedDescription
        }
    }

    // Per-tab list filters. Nil = inherit the global selectedTaskListIDs.
    func setTasksTabListFilter(_ ids: Set<TaskListMirror.ID>?) {
        if let ids {
            settings.tasksTabSelectedListIDs = ids
            settings.hasConfiguredTasksTabSelection = true
        } else {
            settings.tasksTabSelectedListIDs = []
            settings.hasConfiguredTasksTabSelection = false
        }
        scheduleCacheSave()
    }

    func setNotesTabListFilter(_ ids: Set<TaskListMirror.ID>?) {
        if let ids {
            settings.notesTabSelectedListIDs = ids
            settings.hasConfiguredNotesTabSelection = true
        } else {
            settings.notesTabSelectedListIDs = []
            settings.hasConfiguredNotesTabSelection = false
        }
        scheduleCacheSave()
    }

    func setNotesViewMode(_ mode: NotesViewMode) {
        guard settings.notesViewMode != mode else { return }
        settings.notesViewMode = mode
        scheduleCacheSave()
    }

    func setNotesKanbanColumnMode(_ mode: KanbanColumnMode) {
        guard settings.notesKanbanColumnMode != mode else { return }
        settings.notesKanbanColumnMode = mode
        scheduleCacheSave()
    }

    func setColorTagAutoApplyEnabled(_ enabled: Bool) {
        guard settings.colorTagAutoApplyEnabled != enabled else { return }
        settings.colorTagAutoApplyEnabled = enabled
        scheduleCacheSave()
    }

    func setColorTagBinding(colorId: String, tag: String?) {
        let normalized = tag?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let normalized, normalized.isEmpty == false {
            settings.colorTagBindings[colorId] = normalized
        } else {
            settings.colorTagBindings.removeValue(forKey: colorId)
        }
        scheduleCacheSave()
    }

    func setColorTagMatchPolicy(_ policy: ColorTagMatchPolicy) {
        guard settings.colorTagMatchPolicy != policy else { return }
        settings.colorTagMatchPolicy = policy
        scheduleCacheSave()
    }

    // MARK: - Past cleanup setters

    // Switching into/out of .delete resets the ack flag so the user
    // re-consents if they flip it back on after disabling.
    func setPastEventBehavior(_ behavior: PastEventBehavior) {
        guard settings.pastEventBehavior != behavior else { return }
        let wasDeletion = settings.pastEventBehavior.isDeletion
        settings.pastEventBehavior = behavior
        if wasDeletion, behavior.isDeletion == false {
            settings.hasAckedEventDeletion = false
        }
        scheduleCacheSave()
    }

    func setPastEventDeleteThresholdDays(_ days: Int) {
        let clamped = max(1, min(365, days))
        guard settings.pastEventDeleteThresholdDays != clamped else { return }
        settings.pastEventDeleteThresholdDays = clamped
        scheduleCacheSave()
    }

    func setAllowDeletingAttendeeEvents(_ allowed: Bool) {
        guard settings.allowDeletingAttendeeEvents != allowed else { return }
        settings.allowDeletingAttendeeEvents = allowed
        if allowed == false {
            settings.hasAckedAttendeeDeletion = false
        }
        scheduleCacheSave()
    }

    func setShowCompletedItemsInCalendar(_ isVisible: Bool) {
        guard settings.showCompletedItemsInCalendar != isVisible else { return }
        settings.showCompletedItemsInCalendar = isVisible
        rebuildSnapshots()
        scheduleCacheSave()
    }

    func setOverdueTaskBehavior(_ behavior: OverdueTaskBehavior) {
        guard settings.overdueTaskBehavior != behavior else { return }
        settings.overdueTaskBehavior = behavior
        scheduleCacheSave()
    }

    func setCompletedTaskBehavior(_ behavior: CompletedTaskBehavior) {
        guard settings.completedTaskBehavior != behavior else { return }
        let wasDeletion = settings.completedTaskBehavior.isDeletion
        settings.completedTaskBehavior = behavior
        if wasDeletion, behavior.isDeletion == false {
            settings.hasAckedTaskDeletion = false
        }
        scheduleCacheSave()
    }

    func setCompletedTaskDeleteThresholdDays(_ days: Int) {
        let clamped = max(1, min(365, days))
        guard settings.completedTaskDeleteThresholdDays != clamped else { return }
        settings.completedTaskDeleteThresholdDays = clamped
        scheduleCacheSave()
    }

    func acknowledgeEventDeletion() {
        guard settings.hasAckedEventDeletion == false else { return }
        settings.hasAckedEventDeletion = true
        scheduleCacheSave()
    }

    func acknowledgeAttendeeDeletion() {
        guard settings.hasAckedAttendeeDeletion == false else { return }
        settings.hasAckedAttendeeDeletion = true
        scheduleCacheSave()
    }

    func acknowledgeTaskDeletion() {
        guard settings.hasAckedTaskDeletion == false else { return }
        settings.hasAckedTaskDeletion = true
        scheduleCacheSave()
    }

    func setUILayoutScale(_ scale: Double) {
        guard settings.uiLayoutScale != scale else { return }
        settings.uiLayoutScale = scale
        scheduleCacheSave()
    }

    func setUITextSizePoints(_ points: Double) {
        let clamped = HCBTextSize.clamp(points)
        guard settings.uiTextSizePoints != clamped else { return }
        settings.uiTextSizePoints = clamped
        scheduleCacheSave()
    }

    func setUIFontName(_ name: String?) {
        let normalized = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = (normalized?.isEmpty ?? true) ? nil : normalized
        guard settings.uiFontName != resolved else { return }
        settings.uiFontName = resolved
        scheduleCacheSave()
    }

    func setColorSchemeID(_ id: String) {
        guard settings.colorSchemeID != id else { return }
        guard HCBColorScheme.scheme(id: id) != nil else { return }
        settings.colorSchemeID = id
        scheduleCacheSave()
    }

    func setShortcutBinding(_ command: HCBShortcutCommand, binding: HCBKeyBinding?) {
        if let binding {
            settings.shortcutOverrides[command.rawValue] = binding
        } else {
            settings.shortcutOverrides.removeValue(forKey: command.rawValue)
        }
        HCBShortcutStorage.persist(settings.shortcutOverrides)
        scheduleCacheSave()
    }

    func resetAllShortcutBindings() {
        guard settings.shortcutOverrides.isEmpty == false else { return }
        settings.shortcutOverrides.removeAll()
        HCBShortcutStorage.persist(settings.shortcutOverrides)
        scheduleCacheSave()
    }

    func upsertCustomFilter(_ filter: CustomFilterDefinition) {
        if let index = settings.customFilters.firstIndex(where: { $0.id == filter.id }) {
            settings.customFilters[index] = filter
        } else {
            settings.customFilters.append(filter)
        }
        scheduleCacheSave()
    }

    func deleteCustomFilter(_ id: CustomFilterDefinition.ID) {
        settings.customFilters.removeAll { $0.id == id }
        scheduleCacheSave()
    }

    func upsertEventTemplate(_ template: EventTemplate) {
        if let index = settings.eventTemplates.firstIndex(where: { $0.id == template.id }) {
            settings.eventTemplates[index] = template
        } else {
            settings.eventTemplates.append(template)
        }
        scheduleCacheSave()
    }

    func deleteEventTemplate(_ id: EventTemplate.ID) {
        settings.eventTemplates.removeAll { $0.id == id }
        scheduleCacheSave()
    }

    // §6.13b — Instantiates an event template: expands every templated field
    // with the supplied prompt answers + clipboard + date vars, resolves the
    // date + time anchors into a real start Date, and creates a Google event
    // via the existing createEvent path. Returns true on success.
    //
    // Date/time composition:
    //   dateAnchor expands to "YYYY-MM-DD"; empty → today (start-of-day).
    //   timeAnchor is literal "HH:mm" in 24h; empty → now rounded up to the
    //   next 15-minute boundary. When isAllDay, timeAnchor is ignored and
    //   endDate = startDate + max(durationMinutes/1440 * 1, 1) days (treated
    //   as inclusive-end by createEvent).
    //
    // Like task templates, NO template metadata ever lands in the Google
    // event — the resulting event is indistinguishable on google.com from a
    // manually-created one.
    @discardableResult
    func instantiateEventTemplate(_ template: EventTemplate, prompts: [String: String] = [:]) async -> Bool {
        let ctx = HCBTemplateContext(
            now: Date(),
            calendar: .current,
            clipboard: NSPasteboard.general.string(forType: .string),
            prompts: prompts
        )
        func expand(_ s: String) -> String {
            HCBTemplateExpander.expand(s, context: ctx)
                .replacingOccurrences(of: HCBTemplateExpander.cursorSentinel, with: "")
        }

        let summary = expand(template.summary)
        let details = expand(template.details)
        let location = expand(template.location)
        let dateString = expand(template.dateAnchor).trimmingCharacters(in: .whitespacesAndNewlines)
        let calendarRef = expand(template.calendarIdOrTitle).trimmingCharacters(in: .whitespacesAndNewlines)
        let attendees = template.attendees
            .map { expand($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }

        // Resolve date.
        let baseCalendar = Calendar.current
        let now = Date()
        let startOfDay: Date
        if dateString.isEmpty {
            startOfDay = baseCalendar.startOfDay(for: now)
        } else {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd"
            guard let parsed = f.date(from: dateString) else {
                lastMutationError = "Event template '\(template.name)' has an invalid dateAnchor: \(dateString)."
                return false
            }
            startOfDay = baseCalendar.startOfDay(for: parsed)
        }

        // Compose start Date.
        let startDate: Date
        let endDate: Date
        if template.isAllDay {
            startDate = startOfDay
            let days = max(Int(ceil(Double(template.durationMinutes) / (24 * 60))), 1)
            endDate = baseCalendar.date(byAdding: .day, value: days, to: startOfDay) ?? startOfDay
        } else {
            let timeString = template.timeAnchor.trimmingCharacters(in: .whitespacesAndNewlines)
            let (hour, minute): (Int, Int) = {
                if timeString.isEmpty {
                    // Round up to the next 15-minute boundary.
                    let comps = baseCalendar.dateComponents([.hour, .minute], from: now)
                    let rawMin = (comps.minute ?? 0)
                    let bumped = ((rawMin / 15) + 1) * 15
                    if bumped >= 60 {
                        return ((comps.hour ?? 0) + 1, 0)
                    }
                    return (comps.hour ?? 0, bumped)
                }
                let parts = timeString.split(separator: ":").compactMap { Int($0) }
                if parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]) {
                    return (parts[0], parts[1])
                }
                return (9, 0) // fallback default
            }()
            let resolvedStart = baseCalendar.date(bySettingHour: hour, minute: minute, second: 0, of: startOfDay) ?? startOfDay
            startDate = resolvedStart
            endDate = resolvedStart.addingTimeInterval(TimeInterval(max(template.durationMinutes, 5) * 60))
        }

        // Resolve calendar — "" / unknown falls back to the first writable.
        let writable = calendars.filter { $0.accessRole == "owner" || $0.accessRole == "writer" }
        let resolvedCalendarID: CalendarListMirror.ID? = {
            if calendarRef.isEmpty { return writable.first?.id ?? calendars.first?.id }
            if let exact = calendars.first(where: { $0.id == calendarRef }) { return exact.id }
            return calendars.first(where: { $0.summary.localizedCaseInsensitiveCompare(calendarRef) == .orderedSame })?.id
        }()
        guard let calendarID = resolvedCalendarID else {
            lastMutationError = "No calendar available for template '\(template.name)'."
            return false
        }

        // Recurrence: Google expects an array of "RRULE:..." strings.
        let recurrence: [String] = {
            let trimmed = template.recurrenceRule.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.isEmpty == false else { return [] }
            if trimmed.uppercased().hasPrefix("RRULE:") { return [trimmed] }
            return ["RRULE:\(trimmed)"]
        }()

        return await createEvent(
            summary: summary,
            details: details,
            startDate: startDate,
            endDate: endDate,
            isAllDay: template.isAllDay,
            reminderMinutes: template.reminderMinutes,
            calendarID: calendarID,
            location: location,
            recurrence: recurrence,
            attendeeEmails: attendees,
            notifyGuests: false,
            addGoogleMeet: template.addGoogleMeet,
            colorId: template.colorId
        )
    }

    func bulkDeleteEvents(_ events: [CalendarEventMirror]) async -> Int {
        let firstTitle = events.first?.summary ?? ""
        var deleted = 0
        for event in events {
            if await deleteEvent(event, scope: .thisOccurrence) {
                deleted += 1
            }
        }
        if deleted > 1 {
            // suppress N individual eventDelete undo entries behind one bulk summary. individual entries were already recorded in deleteEvent so this is additive for history; performUndo on .bulkAction is a no-op.
            recordUndo(.bulkAction(kind: "delete", count: deleted, firstTitle: firstTitle))
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
        scheduleCacheSave()
    }

    func setMenuBarStyle(_ style: AppSettings.MenuBarStyle) {
        guard settings.menuBarStyle != style else { return }
        settings.menuBarStyle = style
        // Keep legacy bool in sync so older reads don't misreport
        settings.showDetailedMenuBar = (style == .detailed)
        scheduleCacheSave()
    }

    func setTaskCompletionSoundEnabled(_ isEnabled: Bool) {
        guard settings.enableTaskCompletionSound != isEnabled else { return }
        settings.enableTaskCompletionSound = isEnabled
        scheduleCacheSave()
    }

    func setEventCompletionSoundEnabled(_ isEnabled: Bool) {
        guard settings.enableEventCompletionSound != isEnabled else { return }
        settings.enableEventCompletionSound = isEnabled
        scheduleCacheSave()
    }

    func setTaskCompletionSoundChoice(_ choice: CompletionSoundChoice) {
        guard settings.taskCompletionSoundChoice != choice else { return }
        settings.taskCompletionSoundChoice = normalizedCompletionSoundChoice(choice, fallback: .defaultTask)
        scheduleCacheSave()
    }

    func setEventCompletionSoundChoice(_ choice: CompletionSoundChoice) {
        guard settings.eventCompletionSoundChoice != choice else { return }
        settings.eventCompletionSoundChoice = normalizedCompletionSoundChoice(choice, fallback: .defaultEvent)
        scheduleCacheSave()
    }

    @discardableResult
    func importCustomCompletionSound(from sourceURL: URL) throws -> CompletionSoundAsset {
        let asset = try CompletionSoundLibrary.importSound(from: sourceURL)
        settings.customCompletionSounds.insert(asset, at: 0)
        scheduleCacheSave()
        return asset
    }

    func deleteCustomCompletionSound(_ assetID: CompletionSoundAsset.ID) {
        guard let asset = settings.customCompletionSounds.first(where: { $0.id == assetID }) else { return }
        settings.customCompletionSounds.removeAll { $0.id == assetID }
        CompletionSoundLibrary.delete(asset)

        if settings.taskCompletionSoundChoice.customAssetID == assetID {
            settings.taskCompletionSoundChoice = .defaultTask
        }
        if settings.eventCompletionSoundChoice.customAssetID == assetID {
            settings.eventCompletionSoundChoice = .defaultEvent
        }
        scheduleCacheSave()
    }

    func updateLocalNotificationsEnabled(_ isEnabled: Bool) {
        settings.enableLocalNotifications = isEnabled
        Task {
            scheduleCacheSave()
            await runNotificationSync(requestAuthorization: isEnabled)
        }
    }

    func requestEnableLocalNotifications() async -> NotificationAuthorizationOutcome {
        let outcome = await notificationScheduler.authorizationOutcome(requestAuthorization: true)
        switch outcome {
        case .authorized:
            settings.enableLocalNotifications = true
            scheduleCacheSave()
            await runNotificationSync(requestAuthorization: false)
            return .authorized
        case .denied, .notDetermined:
            settings.enableLocalNotifications = false
            scheduleCacheSave()
            await runNotificationSync(requestAuthorization: false)
            return .denied
        }
    }

    func setTaskReminderThresholdDays(_ days: Int) {
        let clamped = max(0, min(365, days))
        guard settings.taskReminderThresholdDays != clamped else { return }
        settings.taskReminderThresholdDays = clamped
        Task {
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        }
    }

    func setTaskReminderTime(hour: Int, minute: Int) {
        let h = max(0, min(23, hour))
        let m = max(0, min(59, minute))
        guard settings.taskReminderHour != h || settings.taskReminderMinute != m else { return }
        settings.taskReminderHour = h
        settings.taskReminderMinute = m
        Task {
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        }
    }

    func completeOnboarding() {
        settings.hasCompletedOnboarding = true
        Task {
            scheduleCacheSave()
        }
    }

    func resetOnboarding() {
        settings.hasCompletedOnboarding = false
        settings.hasSeenFeatureTour = false
        Task {
            scheduleCacheSave()
        }
    }

    func markFeatureTourSeen() {
        guard settings.hasSeenFeatureTour == false else { return }
        settings.hasSeenFeatureTour = true
        Task {
            scheduleCacheSave()
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
        syncFailureKind = nil
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
        let policy = BackoffPolicy.nearRealtime
        var processedIDs: Set<PendingMutation.ID> = []
        for _ in 0..<maxPasses {
            let now = Date()
            // Skip quarantined mutations (they require explicit user action
            // via Diagnostics) and mutations whose backoff window hasn't
            // elapsed yet (we'll pick them up on a later call).
            let snapshot = pendingMutations.filter {
                processedIDs.contains($0.id) == false && $0.isReadyToReplay(now: now, policy: policy)
            }
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

    // On a transient failure, bump attempt count + stamp the backoff timer on
    // the mutation. When we hit BackoffPolicy.maxAttempts, the mutation moves
    // into quarantine and stops auto-replaying. The user can retry or discard
    // from DiagnosticsView.
    private func markMutationTransientFailure(_ mutationID: PendingMutation.ID, error: Error) {
        guard let idx = pendingMutations.firstIndex(where: { $0.id == mutationID }) else { return }
        pendingMutations[idx].attemptCount += 1
        pendingMutations[idx].lastAttemptAt = Date()
        pendingMutations[idx].lastErrorSummary = error.localizedDescription
        if pendingMutations[idx].attemptCount >= BackoffPolicy.nearRealtime.maxAttempts {
            pendingMutations[idx].quarantinedAt = Date()
            AppLogger.warn("mutation quarantined after \(pendingMutations[idx].attemptCount) attempts", category: .replay, metadata: [
                "id": mutationID.uuidString,
                "resourceType": pendingMutations[idx].resourceType.rawValue,
                "action": pendingMutations[idx].action.rawValue,
                "error": error.localizedDescription
            ])
        }
    }

    // Count of mutations that have exceeded the retry ceiling. Drives the
    // AppStatusBanner warning + the DiagnosticsView quarantine section.
    var quarantinedMutationCount: Int {
        pendingMutations.filter(\.isQuarantined).count
    }

    var invalidPayloadMutationCount: Int {
        pendingMutations.filter {
            $0.isQuarantined
                && $0.isConflict == false
                && (($0.lastErrorSummary ?? "").hasPrefix("Invalid payload"))
        }.count
    }

    // Releases a quarantined mutation back into the automatic replay loop.
    // Called from the Diagnostics "Retry" button.
    @discardableResult
    func requeueQuarantinedMutation(id: PendingMutation.ID) -> Bool {
        guard let idx = pendingMutations.firstIndex(where: { $0.id == id }) else { return false }
        pendingMutations[idx].attemptCount = 0
        pendingMutations[idx].lastAttemptAt = nil
        pendingMutations[idx].lastErrorSummary = nil
        pendingMutations[idx].quarantinedAt = nil
        pendingMutations[idx].conflictedAt = nil
        Task {
            scheduleCacheSave()
            await replayPendingMutations()
        }
        return true
    }

    // On a 412 Precondition Failed from the replay path, instead of dropping
    // the queued write + silently refreshing (which lost the user's edit),
    // flag the mutation as a conflict. The user resolves it from Diagnostics
    // via "Keep my change" (forceOverwriteConflictedMutation — re-issues the
    // write without etag) or "Discard" (clearPendingMutation).
    private func markMutationConflict(_ mutationID: PendingMutation.ID, error: Error) {
        guard let idx = pendingMutations.firstIndex(where: { $0.id == mutationID }) else { return }
        pendingMutations[idx].lastAttemptAt = Date()
        pendingMutations[idx].lastErrorSummary = "Server changed underneath — choose whose change wins."
        pendingMutations[idx].quarantinedAt = Date()
        pendingMutations[idx].conflictedAt = Date()
        AppLogger.warn("mutation conflict — 412 on replay", category: .replay, metadata: [
            "id": mutationID.uuidString,
            "resourceType": pendingMutations[idx].resourceType.rawValue,
            "action": pendingMutations[idx].action.rawValue,
            "error": error.localizedDescription
        ])
    }

    private func markMutationInvalidPayload(_ mutationID: PendingMutation.ID, error: GoogleAPIError) {
        guard let idx = pendingMutations.firstIndex(where: { $0.id == mutationID }) else { return }
        pendingMutations[idx].lastAttemptAt = Date()
        pendingMutations[idx].lastErrorSummary = "Invalid payload — Google rejected this queued write. Copy the payload, fix the source data, then retry."
        pendingMutations[idx].quarantinedAt = Date()
        AppLogger.warn("mutation quarantined — invalid payload", category: .replay, metadata: [
            "id": mutationID.uuidString,
            "resourceType": pendingMutations[idx].resourceType.rawValue,
            "action": pendingMutations[idx].action.rawValue,
            "error": error.localizedDescription
        ])
    }

    // Force-reissue a conflicted mutation without If-Match so Google accepts
    // it as an unconditional overwrite of the current server state. Called
    // from the Diagnostics "Keep my change" button.
    @discardableResult
    func forceOverwriteConflictedMutation(id: PendingMutation.ID) async -> Bool {
        guard let mutation = pendingMutations.first(where: { $0.id == id }),
              mutation.isConflict
        else { return false }
        do {
            switch (mutation.resourceType, mutation.action) {
            case (.task, .update):
                let payload = try PendingMutationEncoder.decodeTaskUpdate(mutation.payload)
                let updated = try await tasksClient.updateTask(
                    taskListID: payload.taskListID,
                    taskID: payload.taskID,
                    title: payload.title,
                    notes: payload.notes,
                    dueDate: payload.dueDate,
                    ifMatch: nil
                )
                upsert(updated)
            case (.task, .completion):
                let payload = try PendingMutationEncoder.decodeTaskCompletion(mutation.payload)
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
                    etag: nil,
                    updatedAt: nil
                )
                let updated = try await tasksClient.setTaskCompleted(payload.isCompleted, task: stub)
                upsert(updated)
            case (.task, .delete):
                let payload = try PendingMutationEncoder.decodeTaskDelete(mutation.payload)
                try await tasksClient.deleteTask(taskListID: payload.taskListID, taskID: payload.taskID, ifMatch: nil)
                removeTask(id: payload.taskID)
            case (.event, .update):
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
                    hcbTaskID: payload.hcbTaskID,
                    ifMatch: nil
                )
                upsert(updated)
            case (.event, .delete):
                let payload = try PendingMutationEncoder.decodeEventDelete(mutation.payload)
                try await calendarClient.deleteEvent(calendarID: payload.calendarID, eventID: payload.eventID, ifMatch: nil)
                removeEvent(id: payload.eventID)
            default:
                // Create mutations never 412 (no etag). Only updates/deletes
                // reach this state.
                return false
            }
            pendingMutations.removeAll { $0.id == id }
            scheduleCacheSave()
            await synchronizeLocalNotifications()
            return true
        } catch {
            lastMutationError = "Overwrite failed: \(error.localizedDescription)"
            return false
        }
    }

    var conflictedMutationCount: Int {
        pendingMutations.filter(\.isConflict).count
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
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Task couldn't be created on Google. The queued payload was preserved in Sync Issues."
            scheduleCacheSave()
        } catch {
            if let payload = try? PendingMutationEncoder.decodeTaskCreate(mutation.payload) {
                removeTask(id: payload.localID)
            }
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Task couldn't be created: \(error.localizedDescription)"
            scheduleCacheSave()
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
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Queued task update was preserved in Sync Issues because Google rejected its payload."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            // Queued edit raced a server-side change. Don't silently drop —
            // surface as a conflict the user resolves from Diagnostics.
            markMutationConflict(mutation.id, error: error)
            scheduleCacheSave()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued task update failed: \(error.localizedDescription)"
            scheduleCacheSave()
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
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Queued task completion was preserved in Sync Issues because Google rejected its payload."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            markMutationConflict(mutation.id, error: error)
            scheduleCacheSave()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued completion failed: \(error.localizedDescription)"
            scheduleCacheSave()
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
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Queued task delete was preserved in Sync Issues because Google rejected its payload."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            markMutationConflict(mutation.id, error: error)
            scheduleCacheSave()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued delete failed: \(error.localizedDescription)"
            scheduleCacheSave()
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
                hcbTaskID: payload.hcbTaskID,
                ifMatch: payload.etagSnapshot
            )
            upsert(updated)
            pendingMutations.removeAll { $0.id == mutation.id }
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Queued event update was preserved in Sync Issues because Google rejected its payload."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            markMutationConflict(mutation.id, error: error)
            scheduleCacheSave()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued event update failed: \(error.localizedDescription)"
            scheduleCacheSave()
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
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Queued event delete was preserved in Sync Issues because Google rejected its payload."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error == .preconditionFailed {
            markMutationConflict(mutation.id, error: error)
            scheduleCacheSave()
            await refreshNow()
        } catch {
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Queued event delete failed: \(error.localizedDescription)"
            scheduleCacheSave()
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
                colorId: payload.colorId,
                hcbTaskID: payload.hcbTaskID
            )
            removeEvent(id: payload.localID)
            upsert(created)
            pendingMutations.removeAll { $0.id == mutation.id }
            scheduleCacheSave()
            await synchronizeLocalNotifications()
        } catch let error as GoogleAPIError where error.isTransient {
            markMutationTransientFailure(mutation.id, error: error)
            lastMutationError = "Can't reach Google right now — queued for automatic retry."
            scheduleCacheSave()
        } catch let error as GoogleAPIError where error.isInvalidPayload {
            markMutationInvalidPayload(mutation.id, error: error)
            lastMutationError = "Event couldn't be created on Google. The queued payload was preserved in Sync Issues."
            scheduleCacheSave()
        } catch {
            if let payload = try? PendingMutationEncoder.decodeEventCreate(mutation.payload) {
                removeEvent(id: payload.localID)
            }
            pendingMutations.removeAll { $0.id == mutation.id }
            lastMutationError = "Event couldn't be created: \(error.localizedDescription)"
            scheduleCacheSave()
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
        scheduleRebuildSnapshots()
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

    func cacheFootprintDescription() async -> String {
        let bytes = await cacheStore.cacheFootprintBytes()
        guard bytes > 0 else { return "No local cache file found" }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
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
        scheduleRebuildSnapshots()
        scheduleCacheSave()
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
        scheduleRebuildSnapshots()
        scheduleCacheSave()
    }

    func task(id: TaskMirror.ID) -> TaskMirror? {
        guard let index = taskIndexByID[id],
              tasks.indices.contains(index),
              tasks[index].id == id else {
            // Snapshot rebuilds are intentionally coalesced to the next tick.
            // During that tiny stale-index window, fall back to a scan instead
            // of returning the wrong mirror after an insertion/removal shifts.
            return tasks.first { $0.id == id }
        }
        return tasks[index]
    }

    func event(id: CalendarEventMirror.ID) -> CalendarEventMirror? {
        guard let index = eventIndexByID[id],
              events.indices.contains(index),
              events[index].id == id else {
            return events.first { $0.id == id }
        }
        return events[index]
    }

    func taskListTitle(for id: TaskListMirror.ID, fallback: String = "Unknown list") -> String {
        taskListTitleByID[id] ?? fallback
    }

    func calendarTitle(for id: CalendarListMirror.ID, fallback: String = "Calendar") -> String {
        calendarTitleByID[id] ?? fallback
    }

    func openTaskCount(forTaskListID id: TaskListMirror.ID) -> Int {
        taskListCompletionStats[id]?.openCount ?? 0
    }

    private func apply(_ state: CachedAppState) {
        // Sync-diff detection: count net changes vs current in-memory state BEFORE
        // we overwrite. Skipped on cold launch (empty local) and when nothing
        // differed (steady-state poll). Only the net diff is recorded so the
        // history log isn't spammed every 30s refresh tick.
        let priorTasks = tasks
        let priorEvents = events
        let shouldEmitSyncDiff = priorTasks.isEmpty == false || priorEvents.isEmpty == false

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
        autoIncludeNewTaskLists()
        rebuildSnapshots()
        // apply user's configured retention cap to the audit log actor on boot / after any apply (settings could have been sync-pulled remotely too).
        let cap = settings.historyStorageCap
        Task { await MutationAuditLog.shared.setRetentionLimit(cap) }

        if shouldEmitSyncDiff {
            Self.recordSyncDiffAsync(
                priorTasks: priorTasks,
                priorEvents: priorEvents,
                nextTasks: state.tasks,
                nextEvents: state.events
            )
        }
    }

    // Counts sync diffs away from the main apply path. These history records
    // are informational only, so they should not delay freshly synced data
    // becoming visible.
    nonisolated private static func recordSyncDiffAsync(
        priorTasks: [TaskMirror],
        priorEvents: [CalendarEventMirror],
        nextTasks: [TaskMirror],
        nextEvents: [CalendarEventMirror]
    ) {
        Task.detached(priority: .utility) {
            let priorTaskMap = Dictionary(uniqueKeysWithValues: priorTasks.map { ($0.id, $0) })
            let nextTaskMap = Dictionary(uniqueKeysWithValues: nextTasks.map { ($0.id, $0) })
            let priorEventMap = Dictionary(uniqueKeysWithValues: priorEvents.map { ($0.id, $0) })
            let nextEventMap = Dictionary(uniqueKeysWithValues: nextEvents.map { ($0.id, $0) })

            let taskDiff = syncDiffCount(prior: priorTaskMap, next: nextTaskMap)
            let eventDiff = syncDiffCount(prior: priorEventMap, next: nextEventMap)

            if taskDiff > 0 {
                await MutationAuditLog.shared.record(
                    kind: "sync.task",
                    resourceID: "",
                    summary: "sync",
                    metadata: ["count": String(taskDiff)],
                    priorSnapshotJSON: nil,
                    postSnapshotJSON: nil
                )
            }
            if eventDiff > 0 {
                await MutationAuditLog.shared.record(
                    kind: "sync.event",
                    resourceID: "",
                    summary: "sync",
                    metadata: ["count": String(eventDiff)],
                    priorSnapshotJSON: nil,
                    postSnapshotJSON: nil
                )
            }
        }
    }

    nonisolated private static func syncDiffCount<V: Equatable>(
        prior: [String: V],
        next: [String: V]
    ) -> Int {
        var count = 0
        for (id, newValue) in next {
            if let oldValue = prior[id] {
                if oldValue != newValue { count += 1 }
            } else {
                count += 1
            }
        }
        for id in prior.keys where next[id] == nil { count += 1 }
        return count
    }

    // When sync brings a new TaskListMirror that the user hasn't seen yet,
    // append its id to any *configured* per-tab/global selection sets so
    // the new list is visible by default. Without this, a newly-created
    // Google Tasks list silently disappears from HCB the next time the
    // user opens it because the configured-selection check filters it out.
    // Unconfigured selections (hasConfigured == false) already show every
    // list; nothing to do for those.
    private func autoIncludeNewTaskLists() {
        let allIDs = Set(taskLists.map(\.id))
        var changed = false
        if settings.hasConfiguredTaskListSelection {
            let missing = allIDs.subtracting(settings.selectedTaskListIDs)
            if missing.isEmpty == false {
                settings.selectedTaskListIDs.formUnion(missing)
                changed = true
            }
        }
        if settings.hasConfiguredTasksTabSelection {
            let missing = allIDs.subtracting(settings.tasksTabSelectedListIDs)
            if missing.isEmpty == false {
                settings.tasksTabSelectedListIDs.formUnion(missing)
                changed = true
            }
        }
        if settings.hasConfiguredNotesTabSelection {
            let missing = allIDs.subtracting(settings.notesTabSelectedListIDs)
            if missing.isEmpty == false {
                settings.notesTabSelectedListIDs.formUnion(missing)
                changed = true
            }
        }
        if changed {
            AppLogger.info("auto-included new task lists in selection", category: .sync)
        }
    }

    private func installPreviewData() {
        apply(.preview)
        authState = .signedIn(.preview)
        syncState = .synced(at: Date())
    }

    private func upsert(_ task: TaskMirror) {
        if let index = taskArrayIndex(for: task.id) {
            tasks[index] = task
        } else {
            taskIndexByID[task.id] = tasks.count
            tasks.append(task)
        }
        scheduleRebuildSnapshots()
    }

    private func upsert(_ taskList: TaskListMirror) {
        if let index = taskListArrayIndex(for: taskList.id) {
            taskLists[index] = taskList
        } else {
            taskListIndexByID[taskList.id] = taskLists.count
            taskLists.append(taskList)
        }
        scheduleRebuildSnapshots()
    }

    private func removeTaskList(id: TaskListMirror.ID) {
        if let index = taskListArrayIndex(for: id) {
            taskLists.remove(at: index)
            rebuildTaskListIndex()
        } else {
            taskLists.removeAll { $0.id == id }
            rebuildTaskListIndex()
        }
        tasks.removeAll { $0.taskListID == id }
        rebuildTaskIndex()
        settings.selectedTaskListIDs.remove(id)
        syncCheckpoints.removeAll { checkpoint in
            checkpoint.resourceType == .taskList && checkpoint.resourceID == id
        }
        scheduleRebuildSnapshots()
    }

    private func removeTask(id: TaskMirror.ID) {
        if let index = taskArrayIndex(for: id) {
            tasks.remove(at: index)
            rebuildTaskIndex()
        } else {
            let originalCount = tasks.count
            tasks.removeAll { $0.id == id }
            if tasks.count != originalCount {
                rebuildTaskIndex()
            }
        }
        scheduleRebuildSnapshots()
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
        if let index = eventArrayIndex(for: resolved.id) {
            events[index] = resolved
        } else {
            eventIndexByID[resolved.id] = events.count
            events.append(resolved)
        }
        scheduleRebuildSnapshots()
    }

    private func removeEvent(id: CalendarEventMirror.ID) {
        if let index = eventArrayIndex(for: id) {
            events.remove(at: index)
            rebuildEventIndex()
        } else {
            let originalCount = events.count
            events.removeAll { $0.id == id }
            if events.count != originalCount {
                rebuildEventIndex()
            }
        }
        scheduleRebuildSnapshots()
    }

    private func taskArrayIndex(for id: TaskMirror.ID) -> Int? {
        if let index = taskIndexByID[id],
           tasks.indices.contains(index),
           tasks[index].id == id {
            return index
        }
        return tasks.firstIndex { $0.id == id }
    }

    private func eventArrayIndex(for id: CalendarEventMirror.ID) -> Int? {
        if let index = eventIndexByID[id],
           events.indices.contains(index),
           events[index].id == id {
            return index
        }
        return events.firstIndex { $0.id == id }
    }

    private func taskListArrayIndex(for id: TaskListMirror.ID) -> Int? {
        if let index = taskListIndexByID[id],
           taskLists.indices.contains(index),
           taskLists[index].id == id {
            return index
        }
        return taskLists.firstIndex { $0.id == id }
    }

    private func rebuildTaskIndex() {
        taskIndexByID = Dictionary(uniqueKeysWithValues: tasks.enumerated().map { ($0.element.id, $0.offset) })
    }

    private func rebuildEventIndex() {
        eventIndexByID = Dictionary(uniqueKeysWithValues: events.enumerated().map { ($0.element.id, $0.offset) })
    }

    private func rebuildTaskListIndex() {
        taskListIndexByID = Dictionary(uniqueKeysWithValues: taskLists.enumerated().map { ($0.element.id, $0.offset) })
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

    // Synchronous flush. Use only from explicit-flush sites (logout,
    // scenePhase background, tests). Routine mutations should call
    // scheduleCacheSave() so dozens of rapid writes during a sync flush
    // coalesce into a single disk hit.
    private func saveCurrentState() async {
        pendingSaveTask?.cancel()
        pendingSaveTask = nil
        await cacheStore.save(currentCachedState())
    }

    // Debounced save. Multiple calls within a 500ms window collapse into
    // one cacheStore.save invocation. Snapshots the current state at
    // schedule time so the actual write reflects the last call's state
    // even if more mutations land before the timer fires. The 500ms
    // window is long enough to absorb a sync flush burst (dozens of
    // upserts in <100ms) yet short enough that user-perceived latency
    // for "did my edit persist?" stays imperceptible.
    private var pendingSaveTask: Task<Void, Never>?

    func scheduleCacheSave() {
        pendingSaveTask?.cancel()
        let store = cacheStore
        pendingSaveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            if Task.isCancelled { return }
            guard let self else { return }
            // Re-snapshot at fire time, not at schedule time, so any mutations
            // between schedule and fire are also persisted.
            let snapshot = self.currentCachedState()
            await store.save(snapshot)
        }
    }

    // Force-flush any pending debounced save. Bind to scenePhase
    // .background and to logout/disconnect flows so a backgrounded app
    // can't lose the last 500ms of mutations.
    func flushPendingCacheSave() async {
        guard let task = pendingSaveTask else { return }
        pendingSaveTask = nil
        task.cancel()
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

    // Notification + Spotlight debounce handles. Kept @ObservationIgnored
    // so cancel/re-assign doesn't invalidate observing views.
    @ObservationIgnored private var notificationDebounce: Task<Void, Never>?
    @ObservationIgnored private var spotlightDebounce: Task<Void, Never>?

    // Every task/event/list mutation path calls this. Previously it ran BOTH
    // the full notification scan AND the full Spotlight domain rebuild in
    // sequence, on the user-facing command path — a checkbox click could
    // trigger a Spotlight domain-delete + re-index of every task and event.
    //
    // Now: the actual work is debounced (notifications 500 ms, Spotlight
    // 2 s) and runs in independent Tasks so a sync flush of dozens of
    // upserts collapses to a single deferred scan per integration. The
    // user's click returns immediately; integrations catch up shortly
    // after with the latest state (Task body reads `self.tasks` / `self.events`
    // at fire time, not at schedule time).
    private func synchronizeLocalNotifications(requestAuthorization: Bool = false) async {
        notificationDebounce?.cancel()
        spotlightDebounce?.cancel()
        notificationDebounce = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard Task.isCancelled == false, let self else { return }
            await self.runNotificationSync(requestAuthorization: requestAuthorization)
        }
        spotlightDebounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard Task.isCancelled == false, let self else { return }
            await self.runSpotlightSync()
        }
    }

    private func runNotificationSync(requestAuthorization: Bool) async {
        // Snapshot on main actor at fire time — reflects the latest state
        // regardless of how many mutations piled up during the debounce.
        let tasksNow = tasks
        let eventsNow = events
        let settingsNow = settings
        await notificationScheduler.synchronize(
            tasks: tasksNow,
            events: eventsNow,
            settings: settingsNow,
            requestAuthorization: requestAuthorization
        )
        lastNotificationScheduleSummary = await notificationScheduler.lastSummary
    }

    private func normalizedCompletionSoundChoice(
        _ choice: CompletionSoundChoice,
        fallback: CompletionSoundChoice
    ) -> CompletionSoundChoice {
        switch choice.source {
        case .system:
            return CompletionSoundLibrary.builtInSoundNames.contains(choice.identifier) ? choice : fallback
        case .custom:
            guard
                let assetID = choice.customAssetID,
                settings.customCompletionSounds.contains(where: { $0.id == assetID })
            else {
                return fallback
            }
            return choice
        }
    }

    private func runSpotlightSync() async {
        let tasksNow = tasks
        let eventsNow = events
        await spotlightIndexer.update(tasks: tasksNow, events: eventsNow)
    }

    // Schedules a coalesced rebuild on the next runloop tick. Multiple
    // calls within the same tick collapse to one. Used by mutation paths
    // (createTask, updateEvent, etc.) so a sync flush of dozens of upserts
    // produces a single snapshot rebuild instead of one per upsert.
    private var snapshotRebuildPending = false

    private func scheduleRebuildSnapshots() {
        if snapshotRebuildPending { return }
        snapshotRebuildPending = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.snapshotRebuildPending = false
            self.rebuildSnapshots()
        }
    }

    private func rebuildSnapshots(referenceDate: Date = Date()) {
        // Synchronous-flush variant. Prefer scheduleRebuildSnapshots() for
        // mutation hot paths so multiple rapid mutations coalesce. Use
        // this only when a downstream caller needs snapshots populated
        // before its next line (apply() after sync, init bootstrap).
        snapshotRebuildPending = false
        let started = ContinuousClock.now
        let visibleTaskListIDs = settings.hasConfiguredTaskListSelection
            ? settings.selectedTaskListIDs
            : Set(taskLists.map(\.id))
        let visibleTaskLists = taskLists.filter { visibleTaskListIDs.contains($0.id) }
        let visibleTasks = tasks.filter { visibleTaskListIDs.contains($0.taskListID) }

        taskSections = TaskListSectionSnapshot.build(taskLists: visibleTaskLists, tasks: visibleTasks)
        todaySnapshot = TodaySnapshot.build(tasks: visibleTasks, events: events, referenceDate: referenceDate)
        calendarSnapshot = CalendarSnapshot.build(calendars: calendars, events: events, referenceDate: referenceDate)

        // Bucket events by calendar id so grid views can skip the
        // per-render full-events filter. Done once here, read O(1) per
        // calendar by callers.
        var byCalendar: [CalendarListMirror.ID: [CalendarEventMirror.ID]] = [:]
        byCalendar.reserveCapacity(calendars.count)
        for event in events where settings.showCompletedItemsInCalendar || event.status != .cancelled {
            byCalendar[event.calendarID, default: []].append(event.id)
        }
        eventsByCalendar = byCalendar

        // Bucket events by day (startOfDay key). Multi-day events appear in
        // every day they overlap. Cap the span at 366 to guard against
        // malformed long-running events from Google (birthdays with bad
        // recurrence expansions etc). TimeInterval key avoids Date hashing
        // overhead at scale.
        let cal = Calendar.current
        var byDay: [TimeInterval: [CalendarEventMirror.ID]] = [:]
        byDay.reserveCapacity(events.count)
        for event in events where settings.showCompletedItemsInCalendar || event.status != .cancelled {
            let startDay = cal.startOfDay(for: event.startDate)
            let endDay = cal.startOfDay(for: event.endDate)
            var day = startDay
            var steps = 0
            while day <= endDay && steps < 366 {
                byDay[day.timeIntervalSinceReferenceDate, default: []].append(event.id)
                guard let next = cal.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
                steps += 1
            }
        }
        eventsByDay = byDay

        // Bucket dated, non-deleted tasks by due date (startOfDay). Completed
        // tasks are included only when the calendar setting asks to show them.
        // Mirrors eventsByDay so the grid + agenda views can skip filtering
        // `model.tasks` on every cell render.
        var tByDay: [TimeInterval: [TaskMirror.ID]] = [:]
        for task in tasks where task.isDeleted == false && (settings.showCompletedItemsInCalendar || task.isCompleted == false) {
            guard let due = task.dueDate else { continue }
            let key = cal.startOfDay(for: due).timeIntervalSinceReferenceDate
            tByDay[key, default: []].append(task.id)
        }
        tasksByDueDate = tByDay

        // Precompute sidebar open-task counts so badges don't re-filter every
        // render. Tasks and Notes can override the global Task Lists
        // visibility independently, so their badges should follow the same
        // per-tab list scopes as their content panes.
        let tasksTabVisibleListIDs = settings.hasConfiguredTasksTabSelection
            ? settings.tasksTabSelectedListIDs
            : visibleTaskListIDs
        let notesTabVisibleListIDs = settings.hasConfiguredNotesTabSelection
            ? settings.notesTabSelectedListIDs
            : visibleTaskListIDs
        var dated = 0
        var undated = 0
        for task in tasks where task.isCompleted == false && task.isDeleted == false {
            if task.dueDate == nil {
                if notesTabVisibleListIDs.contains(task.taskListID) { undated += 1 }
            } else if tasksTabVisibleListIDs.contains(task.taskListID) {
                dated += 1
            }
        }
        datedOpenTaskCount = dated
        undatedOpenTaskCount = undated
        openTaskCountForSidebar = dated + undated

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
        taskListTitleByID = Dictionary(uniqueKeysWithValues: taskLists.map { ($0.id, $0.title) })
        calendarTitleByID = Dictionary(uniqueKeysWithValues: calendars.map { ($0.id, $0.summary) })

        // rebuild duplicate groups last (reads final tasks + dismissedGroupKeys)
        duplicateIndex = DuplicateIndex.build(
            tasks: tasks,
            dismissedGroupKeys: settings.dismissedDuplicateGroups
        )

        // O(1) ID lookup tables. One pass over each collection replaces
        // arbitrary .first(where:) scans scattered across the codebase.
        rebuildTaskIndex()
        rebuildEventIndex()
        rebuildTaskListIndex()

        // Advance the content revision. Any view composing this into a
        // cache key rebuilds its derived snapshot on the next observation
        // tick. Overflow-safe (wraps after ~5 × 10^11 years at 1 bump/ms).
        dataRevision &+= 1

        let elapsed = started.duration(to: .now)
        let micros = (elapsed.components.seconds * 1_000_000)
            + (elapsed.components.attoseconds / 1_000_000_000_000)
        AppLogger.debug("rebuildSnapshots", category: .perf, metadata: [
            "duration_us": String(micros),
            "tasks": String(tasks.count),
            "events": String(events.count),
            "visible_tasks": String(visibleTasks.count)
        ])
    }

    // Public re-index helper for call sites that change dismissedDuplicateGroups but don't otherwise mutate tasks (avoids paying the full rebuildSnapshots cost).
    func rebuildDuplicateIndex() {
        duplicateIndex = DuplicateIndex.build(
            tasks: tasks,
            dismissedGroupKeys: settings.dismissedDuplicateGroups
        )
    }
}

struct TaskListCompletionStats: Equatable, Sendable {
    var total: Int
    var completed: Int
    var openCount: Int { total - completed }
    var fraction: Double { total == 0 ? 0 : Double(completed) / Double(total) }
}
