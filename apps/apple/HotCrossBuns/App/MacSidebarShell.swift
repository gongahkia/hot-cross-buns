import AppKit
import UniformTypeIdentifiers
import CoreSpotlight
import SwiftUI

struct MacSidebarShell: View {
    @Environment(AppModel.self) private var model
    @Environment(NetworkMonitor.self) private var networkMonitor
    @Environment(\.scenePhase) private var scenePhase
    @SceneStorage("sidebarSelection") private var storedSelection: String = SidebarItem.calendar.rawValue
    @SceneStorage("sidebarCollapsed") private var isSidebarCollapsed = false

    private let layoutScaleMin: Double = 0.80
    private let layoutScaleMax: Double = 1.50
    private let layoutScaleStep: Double = 0.05

    private var layoutZoomScale: CGFloat {
        CGFloat(max(layoutScaleMin, min(model.settings.uiLayoutScale, layoutScaleMax)))
    }

    private var dynamicTypeSize: DynamicTypeSize {
        HCBTextSizeLadder.size(forStep: model.settings.uiTextSizeStep)
    }

    // Sized to fit the longest sidebar label ("Calendar") + icon + badge
    // without leaving acres of whitespace. Bumped narrower from 240pt.
    private let expandedSidebarWidthBase: CGFloat = 172
    private let collapsedSidebarWidthBase: CGFloat = 64
    // Top inset reserved so the traffic-light buttons don't overlap the
    // first sidebar row when the window chrome sits over the sidebar.
    private let trafficLightInsetBase: CGFloat = 28

    private var expandedSidebarWidth: CGFloat { expandedSidebarWidthBase * layoutZoomScale }
    private var collapsedSidebarWidth: CGFloat { collapsedSidebarWidthBase * layoutZoomScale }
    private var trafficLightInset: CGFloat { trafficLightInsetBase * layoutZoomScale }

    private var currentSidebarWidth: CGFloat {
        isSidebarCollapsed ? collapsedSidebarWidth : expandedSidebarWidth
    }

    @State private var selection: SidebarItem = .calendar
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all
    @State private var tabRouter = TabRouter()
    @State private var isPresentingOnboarding = false
    @State private var isPresentingCommandPalette = false
    @State private var isPresentingHelp = false
    @State private var appCommandActions = AppCommandActions()
    @State private var vimMonitor = VimKeyboardMonitor()
    @State private var vimState = VimState()
    @State private var appShortcutMonitor: Any?
    @State private var collapsedVimFocus: CollapsedVimFocus = .detail
    @State private var isVimDetailFocused = false

    private enum CollapsedVimFocus {
        case sidebar
        case detail
    }

    private enum CollapsedSidebarDestination: Equatable {
        case item(SidebarItem)
    }

    private var shellCore: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            sidebar
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .animation(.easeInOut(duration: 0.12), value: layoutZoomScale)
        .animation(.easeInOut(duration: 0.12), value: dynamicTypeSize)
    }

    var body: some View {
        shellCore
            .withHCBAppearance(model.settings)
            .appBackground()
            .safeAreaInset(edge: .top) {
                AppStatusBanner(
                    syncState: model.syncState,
                    authState: model.authState,
                    mutationError: model.lastMutationError,
                    isSyncPaused: model.isSyncPaused,
                    retry: {
                        model.resumeSync()
                        Task { await model.refreshNow() }
                    },
                    dismiss: { model.clearFailureState() }
                )
            }
            .sheet(isPresented: $isPresentingOnboarding) {
                OnboardingView()
                    .environment(model)
                    .withHCBAppearance(model.settings)
            }
            .sheet(isPresented: $isPresentingCommandPalette) {
                CommandPaletteView(
                    commands: commandPaletteCommands,
                    onSelectTask: { task in
                        selection = .store
                        tabRouter.router(for: sidebarItemKey(.store)).navigate(to: .task(task.id))
                    },
                    onSelectEvent: { event in
                        selection = .calendar
                        tabRouter.router(for: sidebarItemKey(.calendar)).navigate(to: .event(event.id))
                    }
                )
                .environment(model)
                .withHCBAppearance(model.settings)
            }
            .sheet(isPresented: $isPresentingHelp) {
                HelpView()
                    .environment(model)
                    .withHCBAppearance(model.settings)
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
                selection = SidebarItem(rawValue: storedSelection) ?? .calendar
                configureCommandActions()
                configureVimMonitor()
                configureGlobalHotkey()
                installAppShortcutMonitor()
            }
            .onReceive(NotificationCenter.default.publisher(for: .hcbOpenSettingsTab)) { _ in
                selection = .settings
            }
            .onDisappear {
                uninstallAppShortcutMonitor()
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
            .onReceive(NotificationCenter.default.publisher(for: .hcbZoomIn)) { _ in
                performZoomIn()
            }
            .onReceive(NotificationCenter.default.publisher(for: .hcbZoomOut)) { _ in
                performZoomOut()
            }
            .onReceive(NotificationCenter.default.publisher(for: .hcbZoomReset)) { _ in
                performZoomReset()
            }
            .task {
                await model.loadInitialState()
                isPresentingOnboarding = model.settings.hasCompletedOnboarding == false
                await model.restoreGoogleSession()
                // Only auto-refresh when the session restore actually
                // succeeded. If restoreGoogleSession surfaced a .failed
                // authState (Keychain timing after wake-from-sleep, token
                // expiry, scope revocation), kicking off a refresh would
                // hit 401 and render a misleading "Sync needs attention"
                // banner on every launch even though the user just needs
                // to reconnect.
                if case .signedIn = model.authState {
                    await model.refreshForCurrentSyncMode()
                }
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
                // Coming back to the foreground is an implicit "try again."
                // Clear any persistent-failure pause so the near-realtime
                // loop re-runs and the next refresh actually hits Google.
                model.resumeSync()
                if model.consumePendingSharedItems() {
                    presentSheet(.quickAddTask, on: .store)
                }
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
            selection = .store
            tabRouter.router(for: sidebarItemKey(.store)).navigate(to: .task(id))
        case .event(let id):
            selection = .calendar
            tabRouter.router(for: sidebarItemKey(.calendar)).navigate(to: .event(id))
        }
    }

    @ViewBuilder
    private var sidebar: some View {
        Group {
            if isSidebarCollapsed {
                collapsedSidebar
            } else {
                expandedSidebar
            }
        }
        .frame(width: currentSidebarWidth, alignment: .topLeading)
        .navigationSplitViewColumnWidth(
            min: currentSidebarWidth,
            ideal: currentSidebarWidth,
            max: currentSidebarWidth
        )
        .clipped()
    }

    private var collapseToggle: some View {
        Button {
            toggleSidebarCollapsed()
        } label: {
            Image(systemName: isSidebarCollapsed ? "sidebar.squares.left" : "sidebar.left")
                .hcbFontSystem(size: 13, weight: .semibold)
        }
        .buttonStyle(.borderless)
        .help(isSidebarCollapsed ? "Expand sidebar (⌘S)" : "Collapse to icons (⌘S)")
        .accessibilityLabel(isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar to icons")
    }

    private func toggleSidebarCollapsed() {
        let shouldCollapse = isSidebarCollapsed == false
        isSidebarCollapsed = shouldCollapse
        // After toggling sidebar density, reset Vim navigation focus to sidebar.
        setVimFocus(detail: false)
        if shouldCollapse {
            collapsedVimFocus = .sidebar
        }
    }

    private var collapsedSidebar: some View {
        VStack(spacing: 0) {
            collapseToggle
                .padding(.top, trafficLightInset)
                .hcbScaledPadding(.bottom, 10)
            Divider()
            List {
                ForEach(SidebarItem.allCases) { item in
                    collapsedItemButton(item)
                }
            }
            .listStyle(.sidebar)
        }
        .frame(width: collapsedSidebarWidth)
        .toolbar(removing: .sidebarToggle)
    }

    private var collapsedIconColumn: CGFloat {
        40
    }

    private func collapsedItemButton(_ item: SidebarItem) -> some View {
        let isSelected = selection == item
        return Button {
            collapsedVimFocus = .sidebar
            setVimFocus(detail: false)
            selection = item
        } label: {
            HStack {
                Spacer()
                collapsedSidebarIcon(systemImage: item.systemImage, isSelected: isSelected)
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(.init(top: 0, leading: 0, bottom: 0, trailing: 0))
        .help(item.title)
    }

    private func collapsedSidebarIcon(systemImage: String, isSelected: Bool) -> some View {
        Image(systemName: systemImage)
            .hcbFontSystem(size: 20, weight: .medium)
            .frame(width: collapsedIconColumn, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? AppColor.ember.opacity(0.2) : Color.clear)
            )
            .foregroundStyle(isSelected ? AppColor.ember : AppColor.ink)
    }

    private var expandedSidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                collapseToggle
                Text("Hot Cross Buns")
                    .hcbFont(.headline)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .hcbScaledPadding(.horizontal, 12)
            .padding(.top, trafficLightInset)
            .hcbScaledPadding(.bottom, 10)

            Divider()

            List(selection: sidebarSelectionBinding) {
                ForEach(SidebarItem.allCases) { item in
                    sidebarRow(for: item)
                }
            }
            .listStyle(.sidebar)
        }
        .frame(width: expandedSidebarWidth)
        .toolbar(removing: .sidebarToggle)
    }

    @ViewBuilder
    private var detail: some View {
        let routerKey = sidebarItemKey(selection)
        let router = tabRouter.router(for: routerKey)
        NavigationStack(path: tabRouter.binding(for: routerKey)) {
            selection.makeContentView()
                .withAppDestinations()
        }
        .environment(router)
        .withSheetDestinations(sheet: tabRouter.sheetBinding(for: routerKey))
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
        SidebarItem.allCases.map { .item($0) }
    }

    private var activeCollapsedSidebarDestination: CollapsedSidebarDestination {
        .item(selection)
    }

    private func selectCollapsedSidebarDestination(_ destination: CollapsedSidebarDestination) {
        switch destination {
        case .item(let item):
            selection = item
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
        appCommandActions.newTask = { presentSheet(.quickAddTask, on: .store) }
        appCommandActions.newEvent = { presentSheet(.addEvent, on: .calendar) }
        appCommandActions.refresh = { Task { await model.refreshNow() } }
        appCommandActions.forceResync = { Task { await model.forceFullResync() } }
        appCommandActions.switchTo = { item in selection = item }
        appCommandActions.openDiagnostics = { presentSheet(.diagnostics, on: selection) }
        appCommandActions.openCommandPalette = { isPresentingCommandPalette = true }
        appCommandActions.openHelp = { isPresentingHelp = true }
        appCommandActions.printToday = { TodayPrinter.print(model: model) }
        appCommandActions.exportDayICS = { exportICS(range: .day) }
        appCommandActions.exportWeekICS = { exportICS(range: .week) }
        appCommandActions.zoomIn = { performZoomIn() }
        appCommandActions.zoomOut = { performZoomOut() }
        appCommandActions.zoomReset = { performZoomReset() }
        appCommandActions.isVimDetailFocused = isVimDetailFocused
    }

    private enum ICSRange {
        case day
        case week
    }

    private func exportICS(range: ICSRange) {
        let cal = Calendar.current
        let now = Date()
        let rangeStart: Date
        let rangeEnd: Date
        let suggestedFilename: String
        switch range {
        case .day:
            rangeStart = cal.startOfDay(for: now)
            rangeEnd = cal.date(byAdding: .day, value: 1, to: rangeStart) ?? rangeStart
            suggestedFilename = "hot-cross-buns-\(now.formatted(.iso8601.year().month().day())).ics"
        case .week:
            rangeStart = CalendarGridLayout.startOfWeek(containing: now, calendar: cal)
            rangeEnd = cal.date(byAdding: .day, value: 7, to: rangeStart) ?? rangeStart
            suggestedFilename = "hot-cross-buns-week-\(rangeStart.formatted(.iso8601.year().month().day())).ics"
        }
        let selected = Set(model.calendarSnapshot.selectedCalendars.map(\.id))
        let events = model.events
            .filter { selected.contains($0.calendarID) }
            .filter { $0.status != .cancelled }
            .filter { $0.endDate > rangeStart && $0.startDate < rangeEnd }
            .sorted { $0.startDate < $1.startDate }
        let ics = EventICSExporter.ics(for: events)
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.allowedContentTypes = [UTType(filenameExtension: "ics") ?? .data]
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            try? ics.data(using: .utf8)?.write(to: url)
        }
    }

    private func performZoomIn() {
        adjustLayoutScale(by: layoutScaleStep)
    }

    private func performZoomOut() {
        adjustLayoutScale(by: -layoutScaleStep)
    }

    private func performZoomReset() {
        var next = model.settings
        next.uiLayoutScale = 1.0
        model.updateSettings(next)
    }

    private func adjustLayoutScale(by delta: Double) {
        var next = model.settings
        next.uiLayoutScale = max(layoutScaleMin, min(next.uiLayoutScale + delta, layoutScaleMax))
        model.updateSettings(next)
    }

    private func installAppShortcutMonitor() {
        guard appShortcutMonitor == nil else { return }
        appShortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            handleAppShortcut(event) ? nil : event
        }
    }

    private func uninstallAppShortcutMonitor() {
        if let appShortcutMonitor {
            NSEvent.removeMonitor(appShortcutMonitor)
            self.appShortcutMonitor = nil
        }
    }

    private func handleAppShortcut(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard modifiers.contains(.command) else { return false }
        guard modifiers.intersection([.option, .control]).isEmpty else { return false }
        guard event.isARepeat == false else { return false }

        let rawKey = event.characters?.first
        let plainKey = event.charactersIgnoringModifiers?.first
        switch (rawKey, plainKey) {
        case (_, "s") where modifiers == [.command]:
            toggleSidebarCollapsed()
            return true
        case ("+", _), (_, "="):
            performZoomIn()
            return true
        case ("-", _), (_, "-"):
            performZoomOut()
            return true
        case ("0", _), (_, "0"):
            performZoomReset()
            return true
        default:
            return false
        }
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
                presentSheet(.quickAddTask, on: .store)
            },
            CommandPaletteCommand(
                id: "new-task-detailed",
                title: "New Task (Detailed)",
                subtitle: "Fill out the full task form",
                symbol: "checklist",
                shortcut: "Cmd+Shift+T",
                keywords: ["task", "detailed", "form"]
            ) {
                presentSheet(.addTask, on: .store)
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
                id: "go-calendar",
                title: "Go to Calendar",
                subtitle: "Google Calendar grid with today status",
                symbol: "calendar",
                shortcut: "Cmd+1",
                keywords: ["calendar", "events", "today", "forecast"]
            ) {
                selection = .calendar
            },
            CommandPaletteCommand(
                id: "go-store",
                title: "Go to Store",
                subtitle: "Tasks, notes, smart lists, and saved filters",
                symbol: "brain.head.profile",
                shortcut: "Cmd+2",
                keywords: ["store", "tasks", "notes", "lists", "review"]
            ) {
                selection = .store
            }
        ]
    }

    private func badge(for item: SidebarItem) -> String? {
        switch item {
        case .calendar:
            let count = model.todaySnapshot.scheduledEvents.count
            return count > 0 ? "\(count)" : nil
        case .store:
            let count = model.openTaskCountForSidebar
            return count > 0 ? "\(count)" : nil
        case .settings:
            return nil
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
                    .hcbFontSystem(size: 18, weight: .medium)
                    .hcbScaledFrame(width: 24)
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
        var consecutiveTransientFailures = 0

        while Task.isCancelled == false {
            if model.isSyncPaused {
                // Stop the loop entirely once we've surfaced "sync paused".
                // It restarts when scenePhase re-activates or the user taps
                // refresh — both of which clear the flag before the loop is
                // scheduled again.
                return
            }
            if networkMonitor.reachability == .offline {
                // Don't burn cycles polling when offline. The loop restart
                // on scenePhase.active or a user-initiated refresh will
                // re-enter once reachability recovers.
                return
            }
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
                consecutiveTransientFailures = 0
            case .failed(let error) where policy.shouldBackoff(from: error):
                attempt = min(attempt + 1, policy.maxAttempts)
                consecutiveTransientFailures += 1
                if consecutiveTransientFailures >= policy.maxAttempts {
                    // Persistent backend / network trouble — stop hammering
                    // and surface "Sync paused" so the user can choose when
                    // to retry.
                    model.markSyncPaused()
                    return
                }
            case .failed:
                attempt = 0
                consecutiveTransientFailures = 0
            }
        }
    }

    private func handlePendingAppIntentRoute() {
        // Drain all pending routes — rapid intents are queued in order so
        // we don't silently drop one when two fire back to back. The last
        // sheet-presenting route wins visually (SwiftUI only presents one
        // sheet at a time); non-sheet routes (selection changes) all apply.
        let routes = AppIntentHandoff.consumeAll()
        for route in routes {
            switch route {
            case .addTask:
                presentSheet(.addTask, on: .store)
            case .addEvent:
                presentSheet(.addEvent, on: .calendar)
            case .store:
                selection = .store
            case .calendar:
                selection = .calendar
            }
        }
    }
}

#Preview {
    MacSidebarShell()
        .environment(AppModel.preview)
}
