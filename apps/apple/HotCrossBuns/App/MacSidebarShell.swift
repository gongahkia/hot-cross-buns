import CoreSpotlight
import SwiftUI

struct MacSidebarShell: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @SceneStorage("sidebarSelection") private var storedSelection: String = SidebarItem.today.rawValue
    @SceneStorage("sidebarCollapsed") private var isSidebarCollapsed = false
    @State private var selection: SidebarItem = .today
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all
    @State private var tabRouter = TabRouter()
    @State private var isPresentingOnboarding = false
    @State private var isPresentingCommandPalette = false
    @State private var appCommandActions = AppCommandActions()
    @State private var vimMonitor = VimKeyboardMonitor()

    var body: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            sidebar
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .safeAreaInset(edge: .top) {
            AppStatusBanner(
                syncState: model.syncState,
                authState: model.authState,
                mutationError: model.lastMutationError,
                retry: { Task { await model.refreshNow() } },
                dismiss: { model.clearFailureState() }
            )
        }
        .sheet(isPresented: $isPresentingOnboarding) {
            OnboardingView()
                .environment(model)
        }
        .sheet(isPresented: $isPresentingCommandPalette) {
            CommandPaletteView(commands: commandPaletteCommands)
                .environment(model)
        }
        .focusedSceneValue(\.appCommandActions, appCommandActions)
        .onAppear {
            selection = SidebarItem(rawValue: storedSelection) ?? .today
            configureCommandActions()
            configureVimMonitor()
        }
        .onChange(of: model.settings.enableVimKeybindings) { _, newValue in
            vimMonitor.isEnabled = newValue
        }
        .onChange(of: selection) { _, newValue in
            storedSelection = newValue.rawValue
            configureCommandActions()
        }
        .onChange(of: sidebarVisibility) { _, newValue in
            guard newValue == .detailOnly else { return }
            isSidebarCollapsed = true
            sidebarVisibility = .all
        }
        .task {
            await model.loadInitialState()
            isPresentingOnboarding = model.settings.hasCompletedOnboarding == false
            await model.restoreGoogleSession()
            await model.refreshForCurrentSyncMode()
            handlePendingAppIntentRoute()
        }
        .onChange(of: model.settings.hasCompletedOnboarding) { _, hasCompleted in
            if hasCompleted {
                isPresentingOnboarding = false
            }
        }
        .task(id: nearRealtimeLoopID) {
            await runNearRealtimeSyncLoop()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task {
                await model.refreshForCurrentSyncMode()
                handlePendingAppIntentRoute()
            }
        }
        .onOpenURL { url in
            model.handleAuthRedirect(url)
        }
        .onContinueUserActivity(CSSearchableItemActionType) { userActivity in
            handleSpotlightActivity(userActivity)
        }
    }

    private func handleSpotlightActivity(_ activity: NSUserActivity) {
        guard let uniqueID = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              let identifier = SpotlightIdentifier(uniqueIdentifier: uniqueID) else {
            return
        }

        switch identifier {
        case .task(let id):
            selection = .tasks
            tabRouter.router(for: sidebarItemKey(.tasks)).navigate(to: .task(id))
        case .event(let id):
            selection = .calendar
            tabRouter.router(for: sidebarItemKey(.calendar)).navigate(to: .event(id))
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isSidebarCollapsed.toggle()
                    }
                } label: {
                    Image(systemName: isSidebarCollapsed ? "sidebar.right" : "sidebar.left")
                        .font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")

                if isSidebarCollapsed == false {
                    Text("Hot Cross Buns")
                        .font(.headline)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, isSidebarCollapsed ? 10 : 12)
            .padding(.vertical, 10)

            Divider()

            List(selection: sidebarSelectionBinding) {
                ForEach(SidebarSection.allCases, id: \.self) { section in
                    let items = section.items
                    if items.isEmpty == false {
                        Section(header: sectionHeader(section)) {
                            ForEach(items) { item in
                                sidebarRow(for: item)
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
        }
        .frame(
            minWidth: isSidebarCollapsed ? 62 : 200,
            idealWidth: isSidebarCollapsed ? 62 : 240,
            maxWidth: isSidebarCollapsed ? 68 : 320
        )
    }

    @ViewBuilder
    private var detail: some View {
        let router = tabRouter.router(for: sidebarItemKey(selection))
        NavigationStack(path: tabRouter.binding(for: sidebarItemKey(selection))) {
            selection.makeContentView()
                .withAppDestinations()
        }
        .environment(router)
        .withSheetDestinations(sheet: tabRouter.sheetBinding(for: sidebarItemKey(selection)))
    }

    private var sidebarSelectionBinding: Binding<SidebarItem?> {
        Binding(
            get: { selection },
            set: { newValue in
                if let newValue {
                    selection = newValue
                }
            }
        )
    }

    private var nearRealtimeLoopID: String {
        [
            model.settings.syncMode.rawValue,
            scenePhase == .active ? "active" : "inactive",
            model.account?.id ?? "signed-out"
        ].joined(separator: ":")
    }

    private func configureVimMonitor() {
        vimMonitor.actionHandler = { [appCommandActions] action in
            VimActionDispatcher.dispatch(action, commands: appCommandActions)
        }
        vimMonitor.isEnabled = model.settings.enableVimKeybindings
    }

    private func configureCommandActions() {
        appCommandActions.newTask = { presentSheet(.quickAddTask, on: .tasks) }
        appCommandActions.newEvent = { presentSheet(.addEvent, on: .calendar) }
        appCommandActions.refresh = { Task { await model.refreshNow() } }
        appCommandActions.forceResync = { Task { await model.forceFullResync() } }
        appCommandActions.focusSearch = { selection = .search }
        appCommandActions.switchTo = { item in selection = item }
        appCommandActions.openDiagnostics = { presentSheet(.diagnostics, on: selection) }
        appCommandActions.openCommandPalette = { isPresentingCommandPalette = true }
    }

    private var commandPaletteCommands: [CommandPaletteCommand] {
        [
            CommandPaletteCommand(
                id: "new-task",
                title: "New Task",
                subtitle: "Natural-language quick add",
                symbol: "sparkles",
                shortcut: "Cmd+N",
                keywords: ["task", "create", "new", "quick", "add"]
            ) {
                presentSheet(.quickAddTask, on: .tasks)
            },
            CommandPaletteCommand(
                id: "new-task-detailed",
                title: "New Task (Detailed)",
                subtitle: "Fill out the full task form",
                symbol: "checklist",
                shortcut: "Cmd+Shift+T",
                keywords: ["task", "detailed", "form"]
            ) {
                presentSheet(.addTask, on: .tasks)
            },
            CommandPaletteCommand(
                id: "new-event",
                title: "New Event",
                subtitle: "Create a Google Calendar event",
                symbol: "calendar.badge.plus",
                shortcut: "Cmd+Shift+N",
                keywords: ["event", "calendar", "create", "new"]
            ) {
                presentSheet(.addEvent, on: .calendar)
            },
            CommandPaletteCommand(
                id: "refresh",
                title: "Refresh Sync",
                subtitle: "Sync Google Tasks and Calendar now",
                symbol: "arrow.clockwise",
                shortcut: "Cmd+R",
                keywords: ["refresh", "sync", "reload"]
            ) {
                Task { await model.refreshNow() }
            },
            CommandPaletteCommand(
                id: "force-resync",
                title: "Force Full Resync",
                subtitle: "Clear checkpoints and perform a full sync",
                symbol: "arrow.triangle.2.circlepath.circle",
                shortcut: "Cmd+Shift+R",
                keywords: ["resync", "full", "reset", "checkpoint"]
            ) {
                Task { await model.forceFullResync() }
            },
            CommandPaletteCommand(
                id: "open-diagnostics",
                title: "Diagnostics and Recovery",
                subtitle: "Open sync health and reset tools",
                symbol: "stethoscope",
                shortcut: "Cmd+Option+D",
                keywords: ["diagnostics", "recovery", "errors", "health"]
            ) {
                presentSheet(.diagnostics, on: selection)
            },
            CommandPaletteCommand(
                id: "go-today",
                title: "Go to Today",
                subtitle: "Open Today dashboard",
                symbol: "sun.max",
                shortcut: "Cmd+1",
                keywords: ["today", "dashboard"]
            ) {
                selection = .today
            },
            CommandPaletteCommand(
                id: "go-tasks",
                title: "Go to Tasks",
                subtitle: "Open Google Tasks section",
                symbol: "checklist",
                shortcut: "Cmd+2",
                keywords: ["tasks", "list"]
            ) {
                selection = .tasks
            },
            CommandPaletteCommand(
                id: "go-calendar",
                title: "Go to Calendar",
                subtitle: "Open Google Calendar section",
                symbol: "calendar",
                shortcut: "Cmd+3",
                keywords: ["calendar", "events"]
            ) {
                selection = .calendar
            },
            CommandPaletteCommand(
                id: "go-search",
                title: "Go to Search",
                subtitle: "Open local cache search",
                symbol: "magnifyingglass",
                shortcut: "Cmd+4",
                keywords: ["search", "find", "query"]
            ) {
                selection = .search
            },
            CommandPaletteCommand(
                id: "go-settings",
                title: "Go to Settings",
                subtitle: "Open settings and preferences",
                symbol: "gearshape",
                shortcut: "Cmd+5",
                keywords: ["settings", "preferences"]
            ) {
                selection = .settings
            }
        ]
    }

    private func badge(for item: SidebarItem) -> String? {
        switch item {
        case .today:
            let count = model.todaySnapshot.dueTasks.count
            return count > 0 ? "\(count)" : nil
        case .tasks:
            let count = model.tasks.filter { $0.isCompleted == false && $0.isDeleted == false }.count
            return count > 0 ? "\(count)" : nil
        case .overdue:
            let count = SmartListFilter.overdue.count(in: visibleTasksForSidebar)
            return count > 0 ? "\(count)" : nil
        case .dueToday:
            let count = SmartListFilter.dueToday.count(in: visibleTasksForSidebar)
            return count > 0 ? "\(count)" : nil
        case .next7Days:
            let count = SmartListFilter.next7Days.count(in: visibleTasksForSidebar)
            return count > 0 ? "\(count)" : nil
        case .noDate:
            let count = SmartListFilter.noDate.count(in: visibleTasksForSidebar)
            return count > 0 ? "\(count)" : nil
        default:
            return nil
        }
    }

    private var visibleTasksForSidebar: [TaskMirror] {
        let visibleTaskListIDs: Set<TaskListMirror.ID> = {
            if model.settings.hasConfiguredTaskListSelection {
                return model.settings.selectedTaskListIDs
            }
            return Set(model.taskLists.map(\.id))
        }()
        return model.tasks.filter { visibleTaskListIDs.contains($0.taskListID) }
    }

    @ViewBuilder
    private func sectionHeader(_ section: SidebarSection) -> some View {
        if section.title.isEmpty || isSidebarCollapsed {
            EmptyView()
        } else {
            Text(section.title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
        }
    }

    @ViewBuilder
    private func sidebarRow(for item: SidebarItem) -> some View {
        NavigationLink(value: item) {
            if isSidebarCollapsed {
                Image(systemName: item.systemImage)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 4)
            } else {
                Label {
                    HStack {
                        Text(item.title)
                        Spacer()
                        if let badgeValue = badge(for: item) {
                            Text(badgeValue)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                } icon: {
                    Image(systemName: item.systemImage)
                }
            }
        }
    }

    private func sidebarItemKey(_ item: SidebarItem) -> String {
        item.rawValue
    }

    private func presentSheet(_ sheet: SheetDestination, on item: SidebarItem) {
        selection = item
        tabRouter.router(for: sidebarItemKey(item)).present(sheet)
    }

    private func runNearRealtimeSyncLoop() async {
        guard scenePhase == .active, model.settings.syncMode == .nearRealtime, model.account != nil else {
            return
        }

        let policy = BackoffPolicy.nearRealtime
        var attempt = 0

        while Task.isCancelled == false {
            let delay: Duration = attempt == 0 ? policy.baseDelay : policy.delay(forAttempt: attempt)
            do {
                try await Task.sleep(for: delay)
            } catch {
                return
            }

            let outcome = await model.refreshNow()
            switch outcome {
            case .succeeded, .skipped:
                attempt = 0
            case .failed(let error) where policy.shouldBackoff(from: error):
                attempt = min(attempt + 1, policy.maxAttempts)
            case .failed:
                attempt = 0
            }
        }
    }

    private func handlePendingAppIntentRoute() {
        guard let route = AppIntentHandoff.consumePendingRoute() else {
            return
        }

        switch route {
        case .addTask:
            presentSheet(.addTask, on: .tasks)
        case .addEvent:
            presentSheet(.addEvent, on: .calendar)
        case .today:
            selection = .today
        }
    }
}

#Preview {
    MacSidebarShell()
        .environment(AppModel.preview)
}
