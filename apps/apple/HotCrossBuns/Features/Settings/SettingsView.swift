import GoogleSignInSwift
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @FocusedValue(\.appCommandActions) private var appCommandActions
    @State private var vimSelection: VimTarget = .accountAction

    private enum VimTarget: Hashable {
        case accountAction
        case syncMode
        case syncDetails
        case diagnostics
        case runSetup
        case localReminders
        case menuBarExtra
        case detailedMenuBar
        case dockBadge
        case globalHotkey
        case vimBindings
        case calendar(CalendarListMirror.ID)
        case taskList(TaskListMirror.ID)
    }

    var body: some View {
        ScrollViewReader { proxy in
            List(selection: selectionBinding) {
                Section("Google account") {
                    AccountStatusView(
                        authState: model.authState,
                        account: model.account,
                        connect: {
                            Task {
                                await model.connectGoogleAccount()
                            }
                        },
                        disconnect: {
                            Task {
                                await model.disconnectGoogleAccount()
                            }
                        }
                    )
                    .id(VimTarget.accountAction)
                    .tag(VimTarget.accountAction)
                    .listRowBackground(vimHighlightBackground(for: .accountAction))
                }

                // Sync section only appears after sign-in — mode picker,
                // sync details, diagnostics, and "run setup again" are all
                // no-ops without a Google account. Keeps the first-launch
                // Settings focused on the one action that matters.
                if model.account != nil {
                    Section("Sync") {
                        Picker("Mode", selection: syncModeBinding) {
                            ForEach(SyncMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .syncModePickerStyle()
                        .id(VimTarget.syncMode)
                        .tag(VimTarget.syncMode)
                        .listRowBackground(vimHighlightBackground(for: .syncMode))

                        Text(model.settings.syncMode.detail)
                            .hcbFont(.footnote)
                            .foregroundStyle(.secondary)

                        Button {
                            router.present(.syncSettings)
                        } label: {
                            Label("Sync details", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .id(VimTarget.syncDetails)
                        .tag(VimTarget.syncDetails)
                        .listRowBackground(vimHighlightBackground(for: .syncDetails))

                        Button {
                            router.present(.diagnostics)
                        } label: {
                            Label("Diagnostics and recovery", systemImage: "stethoscope")
                        }
                        .id(VimTarget.diagnostics)
                        .tag(VimTarget.diagnostics)
                        .listRowBackground(vimHighlightBackground(for: .diagnostics))

                        Button {
                            model.resetOnboarding()
                        } label: {
                            Label("Run setup again", systemImage: "sparkles")
                        }
                        .id(VimTarget.runSetup)
                        .tag(VimTarget.runSetup)
                        .listRowBackground(vimHighlightBackground(for: .runSetup))
                    }
                }

                Section("Notifications") {
                    Toggle("Local reminders", isOn: localNotificationsBinding)
                        .id(VimTarget.localReminders)
                        .tag(VimTarget.localReminders)
                        .listRowBackground(vimHighlightBackground(for: .localReminders))
                    Text("Schedules up to 64 pending reminders for due tasks and upcoming events on this device.")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                }

                AppearanceSection()

                KeybindingsSection()

                Section("Mac surfaces") {
                    Toggle("Menu bar extra", isOn: menuBarExtraBinding)
                        .id(VimTarget.menuBarExtra)
                        .tag(VimTarget.menuBarExtra)
                        .listRowBackground(vimHighlightBackground(for: .menuBarExtra))
                    Picker("Menu bar panel", selection: menuBarStyleBinding) {
                        ForEach(AppSettings.MenuBarStyle.allCases, id: \.self) { style in
                            Text(style.title).tag(style)
                        }
                    }
                    .pickerStyle(.menu)
                    Toggle("Dock badge for overdue tasks", isOn: dockBadgeBinding)
                        .id(VimTarget.dockBadge)
                        .tag(VimTarget.dockBadge)
                        .listRowBackground(vimHighlightBackground(for: .dockBadge))
                }

                UpdatesSection()

                Section("Calendars") {
                    if model.calendars.isEmpty {
                        Text("Refresh after connecting Google to load calendars.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.calendars) { calendar in
                            Toggle(isOn: calendarBinding(calendar.id)) {
                                HStack(spacing: 10) {
                                    Circle()
                                        .fill(Color(hex: calendar.colorHex))
                                        .hcbScaledFrame(width: 10, height: 10)
                                    Text(calendar.summary)
                                }
                            }
                            .id(VimTarget.calendar(calendar.id))
                            .tag(VimTarget.calendar(calendar.id))
                            .listRowBackground(vimHighlightBackground(for: .calendar(calendar.id)))
                        }
                    }
                }

                Section("Keyboard") {
                    Toggle("Global quick-add hotkey (Cmd+Shift+Space)", isOn: globalHotkeyBinding)
                        .id(VimTarget.globalHotkey)
                        .tag(VimTarget.globalHotkey)
                        .listRowBackground(vimHighlightBackground(for: .globalHotkey))
                    Text("Capture a task from any app. The Hot Cross Buns quick-add sheet opens immediately, pre-focused.")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                    Toggle("Vim keybindings", isOn: vimBinding)
                        .id(VimTarget.vimBindings)
                        .tag(VimTarget.vimBindings)
                        .listRowBackground(vimHighlightBackground(for: .vimBindings))
                    Text("Modal navigation in lists and sidebar. j/k move, gg top, G bottom, x toggle complete, dd delete, : command palette, / search. Text editors keep native shortcuts.")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                }

                CustomFiltersSection()

                Section("Task lists") {
                    if model.taskLists.isEmpty {
                        Text("Refresh after connecting Google to load task lists.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.taskLists) { taskList in
                            Toggle(isOn: taskListBinding(taskList.id)) {
                                Label(taskList.title, systemImage: "checklist")
                            }
                            .id(VimTarget.taskList(taskList.id))
                            .tag(VimTarget.taskList(taskList.id))
                            .listRowBackground(vimHighlightBackground(for: .taskList(taskList.id)))
                        }
                    }
                }
            }
            .onChange(of: vimSelection) { _, newValue in
                withAnimation(.easeInOut(duration: 0.12)) {
                    proxy.scrollTo(newValue, anchor: .center)
                }
            }
        }
        .appBackground()
        .navigationTitle("Settings")
        .onAppear {
            if vimTargets.contains(vimSelection) == false, let first = vimTargets.first {
                vimSelection = first
            }
            installVimContextHandler()
        }
        .onDisappear {
            removeVimContextHandler()
        }
        .onChange(of: vimTargets) { _, newTargets in
            if newTargets.contains(vimSelection) == false, let first = newTargets.first {
                vimSelection = first
            }
        }
        .onChange(of: appCommandActions == nil) { _, _ in
            installVimContextHandler()
        }
    }

    private var syncModeBinding: Binding<SyncMode> {
        Binding(
            get: { model.settings.syncMode },
            set: { model.updateSyncMode($0) }
        )
    }

    private var localNotificationsBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableLocalNotifications },
            set: { model.updateLocalNotificationsEnabled($0) }
        )
    }

    private var menuBarExtraBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showMenuBarExtra },
            set: { model.setShowMenuBarExtra($0) }
        )
    }

    private var dockBadgeBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showDockBadge },
            set: { model.setShowDockBadge($0) }
        )
    }

    private var detailedMenuBarBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showDetailedMenuBar },
            set: { model.setShowDetailedMenuBar($0) }
        )
    }

    private var menuBarStyleBinding: Binding<AppSettings.MenuBarStyle> {
        Binding(
            get: { model.settings.menuBarStyle },
            set: { model.setMenuBarStyle($0) }
        )
    }

    private var vimBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableVimKeybindings },
            set: { model.setEnableVimKeybindings($0) }
        )
    }

    private var globalHotkeyBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableGlobalHotkey },
            set: { model.setEnableGlobalHotkey($0) }
        )
    }

    private func calendarBinding(_ id: CalendarListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.calendars.first(where: { $0.id == id })?.isSelected ?? false },
            set: { _ in model.toggleCalendar(id) }
        )
    }

    private func taskListBinding(_ id: TaskListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.isTaskListSelected(id) },
            set: { _ in model.toggleTaskList(id) }
        )
    }

    private var selectionBinding: Binding<VimTarget?> {
        Binding(
            get: { model.settings.enableVimKeybindings ? vimSelection : nil },
            set: { newValue in
                guard let newValue else { return }
                vimSelection = newValue
            }
        )
    }

    private var vimTargets: [VimTarget] {
        var targets: [VimTarget] = [
            .accountAction,
            .syncMode,
            .syncDetails,
            .diagnostics,
            .runSetup,
            .localReminders,
            .menuBarExtra,
            .detailedMenuBar,
            .dockBadge,
            .globalHotkey,
            .vimBindings
        ]
        targets.append(contentsOf: model.calendars.map { .calendar($0.id) })
        targets.append(contentsOf: model.taskLists.map { .taskList($0.id) })
        return targets
    }

    @ViewBuilder
    private func vimHighlightBackground(for target: VimTarget) -> some View {
        if model.settings.enableVimKeybindings && vimSelection == target {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColor.ember.opacity(0.18))
        } else {
            Color.clear
        }
    }

    private func installVimContextHandler() {
        appCommandActions?.vimContextHandler = { action in
            handleVimAction(action)
        }
    }

    private func removeVimContextHandler() {
        appCommandActions?.vimContextHandler = { _ in false }
    }

    private func handleVimAction(_ action: VimAction) -> Bool {
        guard model.settings.enableVimKeybindings else { return false }
        guard appCommandActions?.isVimDetailFocused == true else { return false }

        switch action {
        case .moveDown:
            return moveVimSelection(by: 1)
        case .moveUp:
            return moveVimSelection(by: -1)
        case .scrollTop:
            return jumpVimSelection(toTop: true)
        case .scrollBottom:
            return jumpVimSelection(toTop: false)
        case .toggleComplete:
            return activateVimSelection()
        default:
            return false
        }
    }

    private func moveVimSelection(by offset: Int) -> Bool {
        let targets = vimTargets
        guard targets.isEmpty == false else { return false }

        let currentIndex = targets.firstIndex(of: vimSelection) ?? 0
        let nextIndex = max(0, min(currentIndex + offset, targets.count - 1))
        vimSelection = targets[nextIndex]
        return true
    }

    private func jumpVimSelection(toTop: Bool) -> Bool {
        let targets = vimTargets
        guard let next = toTop ? targets.first : targets.last else { return false }
        vimSelection = next
        return true
    }

    private func activateVimSelection() -> Bool {
        switch vimSelection {
        case .accountAction:
            if model.account == nil {
                Task { await model.connectGoogleAccount() }
            } else {
                Task { await model.disconnectGoogleAccount() }
            }
        case .syncMode:
            let modes = SyncMode.allCases
            guard let currentIndex = modes.firstIndex(of: model.settings.syncMode) else {
                return false
            }
            let nextIndex = (currentIndex + 1) % modes.count
            model.updateSyncMode(modes[nextIndex])
        case .syncDetails:
            router.present(.syncSettings)
        case .diagnostics:
            router.present(.diagnostics)
        case .runSetup:
            model.resetOnboarding()
        case .localReminders:
            model.updateLocalNotificationsEnabled(model.settings.enableLocalNotifications == false)
        case .menuBarExtra:
            model.setShowMenuBarExtra(model.settings.showMenuBarExtra == false)
        case .detailedMenuBar:
            model.setShowDetailedMenuBar(model.settings.showDetailedMenuBar == false)
        case .dockBadge:
            model.setShowDockBadge(model.settings.showDockBadge == false)
        case .globalHotkey:
            model.setEnableGlobalHotkey(model.settings.enableGlobalHotkey == false)
        case .vimBindings:
            model.setEnableVimKeybindings(model.settings.enableVimKeybindings == false)
        case .calendar(let id):
            model.toggleCalendar(id)
        case .taskList(let id):
            model.toggleTaskList(id)
        }
        return true
    }
}

extension View {
    func syncModePickerStyle() -> some View {
        pickerStyle(.menu)
    }
}

private struct AccountStatusView: View {
    let authState: AuthState
    let account: GoogleAccount?
    let connect: () -> Void
    let disconnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(authState.title, systemImage: iconName)
                    .hcbFont(.headline)
                Spacer()
                if case .authenticating = authState {
                    ProgressView()
                }
            }

            if case .failed(let message) = authState {
                Text(message)
                    .hcbFont(.footnote)
                    .foregroundStyle(.red)
            }

            if let account {
                Text(account.displayName)
                    .hcbFont(.subheadline, weight: .medium)
                Text(scopeSummary(for: account))
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)

                Button(role: .destructive, action: disconnect) {
                    Text("Disconnect Google")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else {
                GoogleSignInButton(action: connect)
                    .hcbScaledFrame(maxWidth: 320, alignment: .leading)
                    .disabled(isAuthenticating)
            }
        }
        .hcbScaledPadding(.vertical, 6)
    }

    private var isAuthenticating: Bool {
        if case .authenticating = authState {
            return true
        }
        return false
    }

    private var iconName: String {
        switch authState {
        case .signedIn:
            "person.crop.circle.badge.checkmark"
        case .authenticating:
            "hourglass"
        case .failed:
            "exclamationmark.triangle"
        case .signedOut:
            "person.crop.circle.badge.plus"
        }
    }

    private func scopeSummary(for account: GoogleAccount) -> String {
        let granted = [
            account.grantedScopes.contains(GoogleScope.tasks) ? "Tasks" : nil,
            account.grantedScopes.contains(GoogleScope.calendar) ? "Calendar" : nil
        ]
        .compactMap { $0 }

        guard granted.isEmpty == false else {
            return "Google profile connected. Tasks and Calendar scopes still need consent."
        }

        return "Granted scopes: \(granted.joined(separator: ", "))"
    }
}

struct SyncSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            List {
                Section("Current mode") {
                    Text(model.settings.syncMode.title)
                        .hcbFont(.headline)
                    Text(model.settings.syncMode.detail)
                        .foregroundStyle(.secondary)
                }

                Section("Reality check") {
                    Text("Manual only refreshes on request. Balanced refreshes on launch and foreground. Near real-time adds foreground polling every 90 seconds with backoff on rate-limits.")
                        .hcbFont(.callout)
                }
            }
            .navigationTitle("Sync Details")
            .toolbar {
                Button("Close") {
                    dismiss()
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
