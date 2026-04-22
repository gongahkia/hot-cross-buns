import AppKit
import UniformTypeIdentifiers
import CoreSpotlight
import SwiftUI

struct MacSidebarShell: View {
    @Environment(AppModel.self) private var model
    @Environment(NetworkMonitor.self) private var networkMonitor
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openSettings) private var openSettings
    @SceneStorage("sidebarSelection") private var storedSelection: String = SidebarItem.calendar.rawValue
    @SceneStorage("sidebarCollapsed") private var isSidebarCollapsed = false

    private let layoutScaleMin: Double = 0.80
    private let layoutScaleMax: Double = 1.50
    private let layoutScaleStep: Double = 0.05

    private var layoutZoomScale: CGFloat {
        CGFloat(max(layoutScaleMin, min(model.settings.uiLayoutScale, layoutScaleMax)))
    }

    private var textSizePoints: Double {
        HCBTextSize.clamp(model.settings.uiTextSizePoints)
    }

    // Sized to fit the longest sidebar label ("Calendar") + icon + badge
    // without leaving acres of whitespace. Bumped narrower from 240pt.
    private let expandedSidebarWidthBase: CGFloat = 172
    private let collapsedSidebarWidthBase: CGFloat = 64
    private let collapsedIconColumnBase: CGFloat = 40
    private let collapsedIconHeightBase: CGFloat = 36
    private let collapsedIconCornerRadiusBase: CGFloat = 8
    private let collapsedRowMinHeightBase: CGFloat = 42
    private let collapsedRowSpacingBase: CGFloat = 4
    // Top inset reserved so the traffic-light buttons don't overlap the
    // first sidebar row when the window chrome sits over the sidebar.
    private let trafficLightInsetBase: CGFloat = 28

    private var expandedSidebarWidth: CGFloat { expandedSidebarWidthBase * layoutZoomScale }
    private var collapsedSidebarWidth: CGFloat { collapsedSidebarWidthBase * layoutZoomScale }
    private var collapsedIconColumn: CGFloat { collapsedIconColumnBase * layoutZoomScale }
    private var collapsedIconHeight: CGFloat { collapsedIconHeightBase * layoutZoomScale }
    private var collapsedIconCornerRadius: CGFloat { collapsedIconCornerRadiusBase * layoutZoomScale }
    private var collapsedRowMinHeight: CGFloat { collapsedRowMinHeightBase * layoutZoomScale }
    private var collapsedRowSpacing: CGFloat { collapsedRowSpacingBase * layoutZoomScale }
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
    @State private var isPresentingInsertTemplate = false
    @State private var isPresentingInsertEventTemplate = false // §6.13b
    @State private var appCommandActions = AppCommandActions()
    @State private var appShortcutMonitor: Any?
    @State private var deepLinkErrorMessage: String?
    // Leader-key chord state (§6.9). `nil` = inactive; non-nil = collecting
    // keys after a ⌘K press. timeoutTask cancels the collecting state after
    // 3s of inactivity so a stray leader press doesn't lock out single-key
    // typing forever.
    @State private var chordKeys: [String]?
    @State private var chordTimeoutTask: Task<Void, Never>?

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
        .animation(.easeInOut(duration: 0.12), value: textSizePoints)
    }

    var body: some View {
        shellCore
            .id(model.settings.colorSchemeID) // force re-render so AppColor.X picks up the new palette
            .withHCBAppearance(model.settings)
            .environment(\.hcbShortcutOverrides, model.settings.shortcutOverrides)
            .preferredColorScheme(HCBColorScheme.scheme(id: model.settings.colorSchemeID)?.isDark == true ? .dark : .light)
            .appBackground()
            .safeAreaInset(edge: .top) {
                AppStatusBanner(
                    syncState: model.syncState,
                    authState: model.authState,
                    mutationError: model.lastMutationError,
                    isSyncPaused: model.isSyncPaused,
                    quarantinedCount: model.quarantinedMutationCount,
                    conflictCount: model.conflictedMutationCount,
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
                // Merged palette — actions *and* entity search (tasks, notes,
                // events, lists, calendars, saved filters). The old ⌘O
                // switcher was folded in here so there's one surface.
                CommandPaletteView(
                    commands: commandPaletteCommands,
                    onSelectEntity: routeQuickSwitcherEntity
                )
                .environment(model)
                .withHCBAppearance(model.settings)
            }
            .sheet(isPresented: $isPresentingInsertTemplate) {
                InsertTaskTemplateSheet()
                    .environment(model)
                    .withHCBAppearance(model.settings)
            }
            .sheet(isPresented: $isPresentingInsertEventTemplate) {
                InsertEventTemplateSheet()
                    .environment(model)
                    .withHCBAppearance(model.settings)
            }
            .sheet(isPresented: $isPresentingHelp) {
                HelpView()
                    .environment(model)
                    .withHCBAppearance(model.settings)
            }
            .overlay {
                UndoToast()
            }
            .overlay {
                DeepLinkErrorToast(message: $deepLinkErrorMessage)
            }
            .overlay(alignment: .bottomTrailing) {
                if let keys = chordKeys {
                    ChordHUD(
                        currentKeys: keys,
                        hints: HCBChordMatcher.hudHints(current: keys, in: HCBChordRegistry.defaults)
                    )
                    .hcbScaledPadding(18)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.12), value: chordKeys)
            .focusedSceneValue(\.appCommandActions, appCommandActions)
            .onAppear(perform: handleShellAppear)
            .onReceive(NotificationCenter.default.publisher(for: .hcbOpenStoreTab)) { _ in
                selection = .store
            }
            .onReceive(NotificationCenter.default.publisher(for: .hcbOpenNotesTab)) { _ in
                selection = .notes
            }
            .onReceive(NotificationCenter.default.publisher(for: .hcbOpenSettingsWindow)) { _ in
                openSettings()
            }
            .onDisappear {
                uninstallAppShortcutMonitor()
            }
            .onChange(of: model.settings.colorSchemeID, initial: true) { _, newID in
                HCBColorSchemeStore.current = HCBColorScheme.scheme(id: newID) ?? .notion
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
            .onChange(of: model.settings.hiddenSidebarItems) { _, hidden in
                // if the currently-selected tab just got hidden, fall back
                // to the first still-visible item so the detail pane isn't
                // rendering a tab that's no longer in the sidebar.
                if hidden.contains(selection.rawValue), selection.isHideable,
                   let first = visibleSidebarItems.first {
                    selection = first
                }
            }
            .onChange(of: sidebarVisibility) { _, newValue in
                // System toolbar button tries to fully hide — snap back; ⌘S is the only collapse.
                if newValue == .detailOnly {
                    sidebarVisibility = .all
                }
            }
            .modifier(ShellZoomObservers(zoomIn: performZoomIn, zoomOut: performZoomOut, zoomReset: performZoomReset))
            .task { await performInitialLoad() }
            .onChange(of: model.settings.hasCompletedOnboarding) { _, hasCompleted in
                // Re-present onboarding when the flag is flipped back
                // (Settings → "Run setup again"); dismiss when the
                // onboarding flow marks itself completed.
                if hasCompleted {
                    isPresentingOnboarding = false
                } else {
                    isPresentingOnboarding = true
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
                // Deep-link scheme is routed to HCBDeepLinkRouter; everything
                // else (primarily the Google OAuth redirect) stays on the
                // existing auth path so sign-in is never intercepted.
                if url.scheme?.lowercased() == HCBDeepLinkRouter.scheme {
                    handleDeepLink(url)
                } else {
                    model.handleAuthRedirect(url)
                }
            }
            .onContinueUserActivity(CSSearchableItemActionType) { userActivity in
                handleSpotlightActivity(userActivity)
            }
    }

    private func routeQuickSwitcherEntity(_ entity: QuickSwitcherEntity) {
        switch entity {
        case .task(let task):
            selection = .store
            tabRouter.router(for: sidebarItemKey(.store)).present(.editTask(task.id))
        case .event(let event):
            selection = .calendar
            tabRouter.router(for: sidebarItemKey(.calendar)).present(.editEvent(event.id))
        case .taskList:
            // No single-list scope exists in StoreView today — land the user
            // in Store with the "Lists" management view selected so they can
            // click through. Better than silently switching filter.
            selection = .store
            model.pendingStoreFilterKey = "lists"
        case .calendar:
            // Calendar tab has no per-calendar scope control; just land there.
            selection = .calendar
        case .customFilter(let f):
            selection = .store
            model.pendingStoreFilterKey = "custom:\(f.id.uuidString)"
        }
    }

    private func handleDeepLink(_ url: URL) {
        switch HCBDeepLinkRouter.route(url) {
        case .success(let action):
            dispatchDeepLinkAction(action)
        case .failure(let err):
            deepLinkErrorMessage = err.message
        }
    }

    private func dispatchDeepLinkAction(_ action: HCBDeepLinkAction) {
        switch action {
        case .openTask(let id):
            selection = .store
            tabRouter.router(for: sidebarItemKey(.store)).present(.editTask(id))
        case .openEvent(let id):
            selection = .calendar
            tabRouter.router(for: sidebarItemKey(.calendar)).present(.editEvent(id))
        case .newTask(let prefill):
            // Stage the prefill before presenting — AddTaskSheet reads model
            // state on .task and nils the prefill once consumed.
            model.pendingTaskPrefill = prefill
            presentSheet(.addTask, on: .store)
        case .newEvent(let prefill):
            model.pendingEventPrefill = prefill
            presentSheet(.addEvent, on: .calendar)
        case .search(let query):
            model.pendingPaletteQuery = query
            isPresentingCommandPalette = true
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
            tabRouter.router(for: sidebarItemKey(.store)).present(.editTask(id))
        case .event(let id):
            selection = .calendar
            tabRouter.router(for: sidebarItemKey(.calendar)).present(.editEvent(id))
        }
    }

    private var sidebar: some View {
        // Sidebar is always expanded — the collapse-toggle behavior was
        // removed per user request. The collapsedSidebar / toggle plumbing
        // below is unreferenced dead code retained only because it was
        // out of scope to delete in this change.
        expandedSidebar
            .frame(width: expandedSidebarWidth, alignment: .topLeading)
            .navigationSplitViewColumnWidth(
                min: expandedSidebarWidth,
                ideal: expandedSidebarWidth,
                max: expandedSidebarWidth
            )
            .clipped()
            .hcbSurface(.sidebar) // §6.11 per-surface font override
    }

    // Visible collapse toggle removed per user request. ⌘S still toggles via
    // handleAppShortcut in the NSEvent monitor below. Method stays so the
    // shortcut has a mutating entry point.
    private func toggleSidebarCollapsed() {
        isSidebarCollapsed.toggle()
    }

    private var collapsedSidebar: some View {
        VStack(spacing: 0) {
            Color.clear
                .frame(height: trafficLightInset)
            ScrollView(showsIndicators: false) {
                VStack(spacing: collapsedRowSpacing) {
                    Color.clear
                        .hcbScaledFrame(height: 6)
                    ForEach(visibleSidebarItems) { item in
                        collapsedItemButton(item)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.clear)
            /* keep collapsed rows fully custom to avoid List(.sidebar) insets */
        }
        .frame(width: collapsedSidebarWidth)
        .toolbar(removing: .sidebarToggle)
    }

    // SidebarItem.allCases filtered by user-hidden set. Settings is never
    // hidable (see SidebarItem.isHideable), so it always appears here.
    private var visibleSidebarItems: [SidebarItem] {
        SidebarItem.allCases.filter { item in
            item.isHideable == false || model.settings.hiddenSidebarItems.contains(item.rawValue) == false
        }
    }

    private func collapsedItemButton(_ item: SidebarItem) -> some View {
        let isSelected = selection == item
        return Button {
            selection = item
        } label: {
            collapsedSidebarIcon(systemImage: item.systemImage, isSelected: isSelected)
                .frame(maxWidth: .infinity, minHeight: collapsedRowMinHeight, alignment: .center)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(item.title)
    }

    private func collapsedSidebarIcon(systemImage: String, isSelected: Bool) -> some View {
        Image(systemName: systemImage)
            .hcbFontSystem(size: 20, weight: .medium)
            .frame(width: collapsedIconColumn, height: collapsedIconHeight)
            .background(
                RoundedRectangle(cornerRadius: collapsedIconCornerRadius, style: .continuous)
                    .fill(isSelected ? AppColor.ember.opacity(0.2) : Color.clear)
            )
            .foregroundStyle(isSelected ? AppColor.ember : AppColor.ink)
    }

    private var expandedSidebar: some View {
        VStack(spacing: 0) {
            // Reserved gap so the traffic-light window buttons don't overlap
            // the first row. The visible collapse-toggle button was removed
            // per user request — ⌘S still collapses via handleAppShortcut.
            Color.clear
                .frame(height: trafficLightInset)
            List(selection: sidebarSelectionBinding) {
                ForEach(visibleSidebarItems) { item in
                    sidebarRow(for: item)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .frame(width: expandedSidebarWidth)
        .toolbar(removing: .sidebarToggle)
    }

    @ViewBuilder
    private var detail: some View {
        let routerKey = sidebarItemKey(selection)
        let router = tabRouter.router(for: routerKey)
        NavigationStack(path: tabRouter.binding(for: routerKey)) {
            // makeContentView injects router internally on a Group wrapping
            // the concrete tab view — this is the load-bearing injection.
            // The outer .environment calls below are belt-and-braces for
            // sheets/inspectors hoisted out of the NavigationStack.
            selection.makeContentView(router: router)
                .withAppDestinations()
        }
        .environment(\.routerPath, router)
        .withSheetDestinations(router: router)
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

    private func performInitialLoad() async {
        await model.loadInitialState()
        isPresentingOnboarding = model.settings.hasCompletedOnboarding == false
        await model.restoreGoogleSession()
        if case .signedIn = model.authState {
            await model.refreshForCurrentSyncMode()
        }
        handlePendingAppIntentRoute()
    }

    private func handleShellAppear() {
        selection = SidebarItem(rawValue: storedSelection) ?? .calendar
        HCBColorSchemeStore.current = HCBColorScheme.scheme(id: model.settings.colorSchemeID) ?? .notion
        // Pre-refactor builds persisted `hiddenSidebarItems` with a single
        // "store" entry meaning "Store (tasks+notes)". The split maps that
        // to the new paired set so a user who explicitly hid the old tab
        // doesn't get it re-shown as "Tasks" plus "Notes".
        if model.settings.hiddenSidebarItems == ["store"] {
            var next = model.settings
            next.hiddenSidebarItems = ["store", "notes"]
            model.updateSettings(next)
        }
        configureCommandActions()
        configureGlobalHotkey()
        installAppShortcutMonitor()
    }

    private func configureGlobalHotkey() {
        guard let delegate = NSApp.delegate as? AppDelegate else { return }
        delegate.setGlobalHotkeyEnabled(model.settings.enableGlobalHotkey)
    }

    private func configureCommandActions() {
        appCommandActions.newTask = { presentSheet(.quickAddTask, on: .store) }
        appCommandActions.newNote = { presentSheet(.quickAddNote, on: .notes) }
        appCommandActions.newEvent = { presentSheet(.quickAddEvent, on: .calendar) }
        appCommandActions.refresh = { Task { await model.refreshNow() } }
        appCommandActions.forceResync = { Task { await model.forceFullResync() } }
        appCommandActions.switchTo = { item in
            // If the target tab is currently hidden via Layout settings, treat
            // the keyboard shortcut as a no-op rather than auto-unhide.
            guard item.isHideable == false
                || model.settings.hiddenSidebarItems.contains(item.rawValue) == false else { return }
            selection = item
        }
        appCommandActions.openSettingsWindow = { openSettings() }
        appCommandActions.openDiagnostics = { presentSheet(.diagnostics, on: selection) }
        appCommandActions.openCommandPalette = { isPresentingCommandPalette = true }
        appCommandActions.openHelp = { isPresentingHelp = true }
        appCommandActions.printToday = { TodayPrinter.print(model: model) }
        appCommandActions.exportDayICS = { exportICS(range: .day) }
        appCommandActions.exportWeekICS = { exportICS(range: .week) }
        appCommandActions.zoomIn = { performZoomIn() }
        appCommandActions.zoomOut = { performZoomOut() }
        appCommandActions.zoomReset = { performZoomReset() }
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

        // While collecting a chord, no modifiers needed — next keydown is
        // consumed as the next key in the sequence. Esc cancels.
        if chordKeys != nil {
            if event.keyCode == 53 { // escape
                cancelChord()
                return true
            }
            // Any modifier besides shift (for capital letters) breaks chord
            // mode and falls through to normal handling.
            if modifiers.intersection([.command, .option, .control]).isEmpty == false {
                cancelChord()
                return false
            }
            guard let char = event.charactersIgnoringModifiers?.first else {
                return false
            }
            advanceChord(with: String(char).lowercased())
            return true
        }

        guard modifiers.contains(.command) else { return false }
        guard modifiers.intersection([.option, .control]).isEmpty else { return false }
        guard event.isARepeat == false else { return false }

        let rawKey = event.characters?.first
        let plainKey = event.charactersIgnoringModifiers?.first

        // ⌘K enters chord mode. Check before the other shortcuts so it wins
        // over any downstream binding that might share the key.
        if modifiers == [.command], plainKey == "k" {
            startChord()
            return true
        }

        switch (rawKey, plainKey) {
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

    // MARK: - chord state machine

    private func startChord() {
        chordKeys = []
        armChordTimeout()
    }

    private func advanceChord(with key: String) {
        var keys = chordKeys ?? []
        keys.append(key)
        chordKeys = keys

        let bindings = HCBChordRegistry.defaults
        let survivors = HCBChordMatcher.matches(current: keys, in: bindings)
        if survivors.isEmpty {
            // No binding starts with this prefix — cancel. Don't eat
            // subsequent keystrokes; the user expects typing to resume.
            cancelChord()
            return
        }
        if let terminal = HCBChordMatcher.isExactTerminal(current: keys, in: bindings) {
            executeChord(terminal)
            return
        }
        // Still matching; keep collecting.
        armChordTimeout()
    }

    private func executeChord(_ binding: HCBChordBinding) {
        cancelChord()
        appCommandActions.execute(binding.command)
    }

    private func cancelChord() {
        chordTimeoutTask?.cancel()
        chordTimeoutTask = nil
        chordKeys = nil
    }

    private func armChordTimeout() {
        chordTimeoutTask?.cancel()
        chordTimeoutTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            if Task.isCancelled { return }
            chordKeys = nil
        }
    }

    private var commandPaletteCommands: [CommandPaletteCommand] {
        [
            CommandPaletteCommand(
                id: "new-task",
                title: "Smart Add Task",
                subtitle: "Natural-language quick add",
                symbol: "sparkles",
                shortcut: "Cmd+N",
                keywords: ["task", "create", "new", "quick", "add", "smart"]
            ) {
                presentSheet(.quickAddTask, on: .store)
            },
            CommandPaletteCommand(
                id: "new-note",
                title: "Smart Add Note",
                subtitle: "Natural-language note capture",
                symbol: "note.text.badge.plus",
                shortcut: "",
                keywords: ["note", "create", "new", "quick", "add", "smart"]
            ) {
                presentSheet(.quickAddNote, on: .notes)
            },
            CommandPaletteCommand(
                id: "new-event",
                title: "Smart Add Event",
                subtitle: "Natural-language event capture",
                symbol: "calendar.badge.plus",
                shortcut: "Cmd+Shift+N",
                keywords: ["event", "calendar", "create", "new", "smart"]
            ) {
                presentSheet(.quickAddEvent, on: .calendar)
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
                id: "new-event-detailed",
                title: "New Event (Detailed)",
                subtitle: "Fill out the full event form",
                symbol: "calendar",
                shortcut: "",
                keywords: ["event", "calendar", "detailed", "form"]
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
                title: "Go to Tasks",
                subtitle: "Kanban board of dated tasks across every list",
                symbol: "checklist",
                shortcut: "Cmd+2",
                keywords: ["tasks", "kanban", "lists", "store"]
            ) {
                selection = .store
            },
            CommandPaletteCommand(
                id: "go-notes",
                title: "Go to Notes",
                subtitle: "Quick-capture cards — tasks without a due date",
                symbol: "note.text",
                shortcut: "Cmd+3",
                keywords: ["notes", "capture", "undated", "someday"]
            ) {
                selection = .notes
            },
            CommandPaletteCommand(
                id: "open-settings",
                title: "Settings…",
                subtitle: "Appearance, account, sync, keyboard, calendars",
                symbol: "gearshape",
                shortcut: "Cmd+,",
                keywords: ["settings", "preferences", "appearance", "font", "theme"]
            ) {
                NotificationCenter.default.post(name: .hcbOpenSettingsWindow, object: nil)
            },
            CommandPaletteCommand(
                id: "insert-task-template",
                title: "Insert Task Template…",
                subtitle: "Pre-fill a task from a saved template",
                symbol: "doc.text",
                shortcut: "",
                keywords: ["template", "insert", "snippet", "prefill", "task"]
            ) {
                isPresentingInsertTemplate = true
            },
            CommandPaletteCommand(
                id: "insert-event-template",
                title: "Insert Event Template…",
                subtitle: "Pre-fill an event from a saved template",
                symbol: "calendar",
                shortcut: "",
                keywords: ["template", "insert", "event", "meeting", "calendar", "snippet", "prefill"]
            ) {
                isPresentingInsertEventTemplate = true
            },
            CommandPaletteCommand(
                id: "open-help",
                title: "Help",
                subtitle: "Keyboard shortcuts, sync behavior, troubleshooting",
                symbol: "questionmark.circle",
                shortcut: "Cmd+?",
                keywords: ["help", "docs", "shortcuts", "keys", "guide"]
            ) {
                isPresentingHelp = true
            }
        ]
    }

    private func badge(for item: SidebarItem) -> String? {
        switch item {
        case .calendar:
            let count = model.todaySnapshot.scheduledEvents.count
            return count > 0 ? "\(count)" : nil
        case .store:
            // Tasks tab badge counts only tasks that actually belong to the
            // Tasks surface — dated, open. Undated ones live in Notes and
            // carry their own count to avoid double-badging the sidebar.
            let count = model.datedOpenTaskCount
            return count > 0 ? "\(count)" : nil
        case .notes:
            let count = model.undatedOpenTaskCount
            return count > 0 ? "\(count)" : nil
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

// Small helper ViewModifier to keep MacSidebarShell.body within the
// SwiftUI type-checker's budget. Each onReceive inflates ModifiedContent
// generics quickly; bundling three of them halves the chain depth.
private struct ShellZoomObservers: ViewModifier {
    let zoomIn: () -> Void
    let zoomOut: () -> Void
    let zoomReset: () -> Void

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: .hcbZoomIn)) { _ in zoomIn() }
            .onReceive(NotificationCenter.default.publisher(for: .hcbZoomOut)) { _ in zoomOut() }
            .onReceive(NotificationCenter.default.publisher(for: .hcbZoomReset)) { _ in zoomReset() }
    }
}

#Preview {
    MacSidebarShell()
        .environment(AppModel.preview)
}
