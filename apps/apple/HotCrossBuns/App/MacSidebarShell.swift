import CoreSpotlight
import SwiftUI

struct MacSidebarShell: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @SceneStorage("sidebarSelection") private var storedSelection: String = SidebarItem.today.rawValue
    @SceneStorage("sidebarCollapsed") private var isSidebarCollapsed = false
    @SceneStorage("uiZoomStep") private var zoomStep: Int = 3 // index into zoomLadder; 3 = .large (default)

    private let zoomLadder: [DynamicTypeSize] = [
        .xSmall, .small, .medium, .large, .xLarge, .xxLarge, .xxxLarge,
        .accessibility1, .accessibility2, .accessibility3
    ]

    private var dynamicTypeSize: DynamicTypeSize {
        zoomLadder[max(0, min(zoomStep, zoomLadder.count - 1))]
    }
    @State private var selection: SidebarItem = .today
    @State private var activeCustomFilterID: CustomFilterDefinition.ID?
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all
    @State private var tabRouter = TabRouter()
    @State private var isPresentingOnboarding = false
    @State private var isPresentingCommandPalette = false
    @State private var isPresentingHelp = false
    @State private var appCommandActions = AppCommandActions()
    @State private var vimMonitor = VimKeyboardMonitor()
    @State private var vimState = VimState()
    @State private var collapsedVimFocus: CollapsedVimFocus = .detail
    @State private var isVimDetailFocused = false

    private enum CollapsedVimFocus {
        case sidebar
        case detail
    }

    private enum CollapsedSidebarDestination: Equatable {
        case item(SidebarItem)
        case customFilter(CustomFilterDefinition.ID)
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            sidebar
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .dynamicTypeSize(dynamicTypeSize)
        .animation(.easeInOut(duration: 0.12), value: zoomStep)
        .appBackground()
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
            CommandPaletteView(
                commands: commandPaletteCommands,
                onSelectTask: { task in
                    selection = .tasks
                    activeCustomFilterID = nil
                    tabRouter.router(for: sidebarItemKey(.tasks)).navigate(to: .task(task.id))
                },
                onSelectEvent: { event in
                    selection = .calendar
                    activeCustomFilterID = nil
                    tabRouter.router(for: sidebarItemKey(.calendar)).navigate(to: .event(event.id))
                }
            )
            .environment(model)
        }
        .sheet(isPresented: $isPresentingHelp) {
            HelpView()
                .environment(model)
        }
        .overlay {
            if model.settings.enableVimKeybindings {
                VimHud()
                    .environment(vimState)
            }
        }
        .overlay {
            UndoToast()
        }
        .focusedSceneValue(\.appCommandActions, appCommandActions)
        .onAppear {
            selection = SidebarItem(rawValue: storedSelection) ?? .today
            configureCommandActions()
            configureVimMonitor()
            configureGlobalHotkey()
        }
        .onChange(of: model.settings.enableVimKeybindings) { _, newValue in
            vimMonitor.isEnabled = newValue
        }
        .onChange(of: model.settings.enableGlobalHotkey) { _, newValue in
            if let delegate = NSApp.delegate as? AppDelegate {
                delegate.setGlobalHotkeyEnabled(newValue)
            }
        }
        .onChange(of: selection) { _, newValue in
            storedSelection = newValue.rawValue
            configureCommandActions()
        }
        .onChange(of: sidebarVisibility) { _, newValue in
            // System toolbar button tries to fully hide — snap back; ⌘S is the only collapse.
            if newValue == .detailOnly {
                sidebarVisibility = .all
            }
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

    @ViewBuilder
    private var sidebar: some View {
        if isSidebarCollapsed {
            collapsedSidebar
        } else {
            expandedSidebar
        }
    }

    private var collapseToggle: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                isSidebarCollapsed.toggle()
                // After toggling sidebar density, reset Vim navigation focus to sidebar.
                setVimFocus(detail: false)
                if isSidebarCollapsed {
                    collapsedVimFocus = .sidebar
                }
            }
        } label: {
            Image(systemName: isSidebarCollapsed ? "sidebar.squares.left" : "sidebar.left")
                .font(.system(size: 13, weight: .semibold))
        }
        .buttonStyle(.borderless)
        .keyboardShortcut("s", modifiers: [.command])
        .help(isSidebarCollapsed ? "Expand sidebar (⌘S)" : "Collapse to icons (⌘S)")
        .accessibilityLabel(isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar to icons")
    }

    private var collapsedSidebar: some View {
        VStack(spacing: 0) {
            collapseToggle
                .padding(.vertical, 10)
            Divider()
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(SidebarSection.allCases, id: \.self) { section in
                        if section == .custom {
                            ForEach(model.settings.customFilters) { filter in
                                collapsedCustomFilterButton(filter)
                            }
                        } else {
                            ForEach(section.items) { item in
                                collapsedItemButton(item)
                            }
                        }
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .frame(width: 28)
        .toolbar(removing: .sidebarToggle)
    }

    private func collapsedItemButton(_ item: SidebarItem) -> some View {
        let isSelected = activeCustomFilterID == nil && selection == item
        return Button {
            collapsedVimFocus = .sidebar
            setVimFocus(detail: false)
            selection = item
            activeCustomFilterID = nil
        } label: {
            Image(systemName: item.systemImage)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 28, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isSelected ? AppColor.ember.opacity(0.2) : Color.clear)
                )
                .foregroundStyle(isSelected ? AppColor.ember : AppColor.ink)
        }
        .buttonStyle(.plain)
        .help(item.title)
    }

    private func collapsedCustomFilterButton(_ filter: CustomFilterDefinition) -> some View {
        let isSelected = activeCustomFilterID == filter.id
        return Button {
            collapsedVimFocus = .sidebar
            setVimFocus(detail: false)
            activeCustomFilterID = filter.id
        } label: {
            Image(systemName: filter.systemImage)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 28, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isSelected ? AppColor.ember.opacity(0.2) : Color.clear)
                )
                .foregroundStyle(isSelected ? AppColor.ember : AppColor.ink)
        }
        .buttonStyle(.plain)
        .help(filter.name)
    }

    private var expandedSidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                collapseToggle
                Text("Hot Cross Buns")
                    .font(.headline)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            List(selection: sidebarSelectionBinding) {
                ForEach(SidebarSection.allCases, id: \.self) { section in
                    if section == .custom {
                        if model.settings.customFilters.isEmpty == false {
                            Section(header: sectionHeader(section)) {
                                ForEach(model.settings.customFilters) { filter in
                                    customFilterRow(filter)
                                }
                            }
                        }
                    } else {
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
            }
            .listStyle(.sidebar)
        }
        .frame(minWidth: 200, idealWidth: 240, maxWidth: 320)
        .toolbar(removing: .sidebarToggle)
    }

    @ViewBuilder
    private var detail: some View {
        let routerKey = activeCustomFilterID.map { "custom-\($0.uuidString)" } ?? sidebarItemKey(selection)
        let router = tabRouter.router(for: routerKey)
        NavigationStack(path: tabRouter.binding(for: routerKey)) {
            if let filterID = activeCustomFilterID {
                CustomFilterView(filterID: filterID)
                    .withAppDestinations()
            } else {
                selection.makeContentView()
                    .withAppDestinations()
            }
        }
        .environment(router)
        .withSheetDestinations(sheet: tabRouter.sheetBinding(for: routerKey))
    }

    private var sidebarSelectionBinding: Binding<SidebarItem?> {
        Binding(
            get: { activeCustomFilterID == nil ? selection : nil },
            set: { newValue in
                if let newValue {
                    selection = newValue
                    activeCustomFilterID = nil
                }
            }
        )
    }

    @ViewBuilder
    private func customFilterRow(_ filter: CustomFilterDefinition) -> some View {
        Button {
            activeCustomFilterID = filter.id
        } label: {
            HStack {
                Label(filter.name, systemImage: filter.systemImage)
                Spacer()
                if activeCustomFilterID == filter.id {
                    Image(systemName: "chevron.right.circle.fill")
                        .foregroundStyle(AppColor.ember)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var nearRealtimeLoopID: String {
        [
            model.settings.syncMode.rawValue,
            scenePhase == .active ? "active" : "inactive",
            model.account?.id ?? "signed-out"
        ].joined(separator: ":")
    }

    private func configureGlobalHotkey() {
        guard let delegate = NSApp.delegate as? AppDelegate else { return }
        delegate.setGlobalHotkeyEnabled(model.settings.enableGlobalHotkey)
    }

    private func configureVimMonitor() {
        vimMonitor.state = vimState
        vimMonitor.actionHandler = { [appCommandActions] action in
            switch action {
            case .moveLeft:
                setVimFocus(detail: false)
            case .moveRight:
                setVimFocus(detail: true)
            default:
                break
            }
            if handleCollapsedSidebarVimAction(action, commands: appCommandActions) {
                return
            }
            VimActionDispatcher.dispatch(action, commands: appCommandActions)
        }
        vimMonitor.isEnabled = model.settings.enableVimKeybindings
    }

    private func setVimFocus(detail: Bool) {
        isVimDetailFocused = detail
        appCommandActions.isVimDetailFocused = detail
    }

    private var collapsedSidebarDestinations: [CollapsedSidebarDestination] {
        var destinations: [CollapsedSidebarDestination] = []
        for section in SidebarSection.allCases {
            if section == .custom {
                destinations.append(contentsOf: model.settings.customFilters.map { .customFilter($0.id) })
            } else {
                destinations.append(contentsOf: section.items.map { .item($0) })
            }
        }
        return destinations
    }

    private var activeCollapsedSidebarDestination: CollapsedSidebarDestination {
        if let activeCustomFilterID {
            return .customFilter(activeCustomFilterID)
        }
        return .item(selection)
    }

    private func selectCollapsedSidebarDestination(_ destination: CollapsedSidebarDestination) {
        switch destination {
        case .item(let item):
            selection = item
            activeCustomFilterID = nil
        case .customFilter(let id):
            activeCustomFilterID = id
        }
    }

    private func handleCollapsedSidebarVimAction(_ action: VimAction, commands: AppCommandActions) -> Bool {
        guard isSidebarCollapsed else { return false }

        switch action {
        case .moveLeft:
            collapsedVimFocus = .sidebar
            VimActionDispatcher.dispatch(action, commands: commands)
            return true
        case .moveRight:
            collapsedVimFocus = .detail
            VimActionDispatcher.dispatch(action, commands: commands)
            return true
        case .moveDown:
            guard collapsedVimFocus == .sidebar else { return false }
            return shiftCollapsedSidebarSelection(by: 1)
        case .moveUp:
            guard collapsedVimFocus == .sidebar else { return false }
            return shiftCollapsedSidebarSelection(by: -1)
        case .scrollTop:
            guard collapsedVimFocus == .sidebar else { return false }
            return jumpCollapsedSidebarSelection(toTop: true)
        case .scrollBottom:
            guard collapsedVimFocus == .sidebar else { return false }
            return jumpCollapsedSidebarSelection(toTop: false)
        default:
            return false
        }
    }

    private func shiftCollapsedSidebarSelection(by offset: Int) -> Bool {
        let destinations = collapsedSidebarDestinations
        guard destinations.isEmpty == false else { return false }

        let currentIndex = destinations.firstIndex(of: activeCollapsedSidebarDestination) ?? 0
        let nextIndex = max(0, min(currentIndex + offset, destinations.count - 1))
        let nextDestination = destinations[nextIndex]
        selectCollapsedSidebarDestination(nextDestination)
        return true
    }

    private func jumpCollapsedSidebarSelection(toTop: Bool) -> Bool {
        let destinations = collapsedSidebarDestinations
        guard let target = toTop ? destinations.first : destinations.last else {
            return false
        }
        selectCollapsedSidebarDestination(target)
        return true
    }

    private func configureCommandActions() {
        appCommandActions.newTask = { presentSheet(.quickAddTask, on: .tasks) }
        appCommandActions.newEvent = { presentSheet(.addEvent, on: .calendar) }
        appCommandActions.refresh = { Task { await model.refreshNow() } }
        appCommandActions.forceResync = { Task { await model.forceFullResync() } }
        appCommandActions.switchTo = { item in selection = item }
        appCommandActions.openDiagnostics = { presentSheet(.diagnostics, on: selection) }
        appCommandActions.openCommandPalette = { isPresentingCommandPalette = true }
        appCommandActions.openHelp = { isPresentingHelp = true }
        appCommandActions.zoomIn = { zoomStep = min(zoomStep + 1, zoomLadder.count - 1) }
        appCommandActions.zoomOut = { zoomStep = max(zoomStep - 1, 0) }
        appCommandActions.zoomReset = { zoomStep = 3 }
        appCommandActions.isVimDetailFocused = isVimDetailFocused
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
                id: "go-settings",
                title: "Go to Settings",
                subtitle: "Open settings and preferences",
                symbol: "gearshape",
                shortcut: "Cmd+4",
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
        if section.title.isEmpty {
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
