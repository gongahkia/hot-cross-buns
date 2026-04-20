import GoogleSignInSwift
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router
    @State private var showLocalNotificationsInfo = false
    @State private var showOnboardingResetConfirmed = false

    var body: some View {
        List {
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
            }

            // Sync section only appears after sign-in — mode picker, sync
            // details, diagnostics, and "run setup again" are no-ops without
            // a Google account.
            if model.account != nil {
                Section("Sync") {
                    Picker("Mode", selection: syncModeBinding) {
                        ForEach(SyncMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .syncModePickerStyle()

                    Text(model.settings.syncMode.detail)
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)

                    Label("Sync details", systemImage: "arrow.triangle.2.circlepath")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { router.present(.syncSettings) }

                    Label("Diagnostics and recovery", systemImage: "stethoscope")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { router.present(.diagnostics) }

                    Label("Run setup again", systemImage: "sparkles")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            model.resetOnboarding()
                            showOnboardingResetConfirmed = true
                        }

                    Picker("Keep past events", selection: eventRetentionBinding) {
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                        Text("2 years").tag(730)
                        Text("Forever").tag(0)
                    }
                    .pickerStyle(.menu)
                    Text("Older events are dropped from the local cache to keep memory + disk tight. Drops never touch Google — a Force Resync refetches everything. Recently-edited events (within the window) are preserved even if they ended earlier.")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Notifications") {
                Toggle("Local reminders", isOn: localNotificationsBinding)
            }
            .alert("Local reminders enabled", isPresented: $showLocalNotificationsInfo) {
                Button("OK") { showLocalNotificationsInfo = false }
            } message: {
                Text("Hot Cross Buns will schedule up to 64 pending reminders on this Mac for the soonest-upcoming due tasks and Calendar events. 64 is an Apple-imposed ceiling for local notifications per app — later items get scheduled automatically as earlier ones fire or complete.")
            }
            .alert("Setup will run now", isPresented: $showOnboardingResetConfirmed) {
                Button("OK") { showOnboardingResetConfirmed = false }
            } message: {
                Text("The onboarding flow has been reset. Switch back to the main Hot Cross Buns window to go through setup again.")
            }

            AppearanceSection()

            PerSurfaceFontSection()

            LayoutSection()

            EncryptionSection()

            KeybindingsSection()

            Section("Mac surfaces") {
                Toggle("Menu bar extra", isOn: menuBarExtraBinding)
                Picker("Menu bar panel", selection: menuBarStyleBinding) {
                    ForEach(AppSettings.MenuBarStyle.allCases, id: \.self) { style in
                        Text(style.title).tag(style)
                    }
                }
                .pickerStyle(.menu)
                Toggle("Dock badge for overdue tasks", isOn: dockBadgeBinding)
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
                    }
                }
            }

            Section("Keyboard") {
                Toggle("Global quick-add hotkey (Cmd+Shift+Space)", isOn: globalHotkeyBinding)
                Text("Capture a task from any app. The Hot Cross Buns quick-add sheet opens immediately, pre-focused.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }

            CustomFiltersSection()

            TemplatesSection()

            Section("Task lists") {
                if model.taskLists.isEmpty {
                    Text("Refresh after connecting Google to load task lists.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.taskLists) { taskList in
                        Toggle(isOn: taskListBinding(taskList.id)) {
                            Label(taskList.title, systemImage: "checklist")
                        }
                    }
                }
            }
        }
        .appBackground()
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
            set: { newValue in
                let wasOff = model.settings.enableLocalNotifications == false
                model.updateLocalNotificationsEnabled(newValue)
                // Only show the explainer on an off→on transition.
                if wasOff, newValue {
                    showLocalNotificationsInfo = true
                }
            }
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

    private var globalHotkeyBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableGlobalHotkey },
            set: { model.setEnableGlobalHotkey($0) }
        )
    }

    private var eventRetentionBinding: Binding<Int> {
        Binding(
            get: { model.settings.eventRetentionDaysBack },
            set: { model.setEventRetentionDaysBack($0) }
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
        // macOS sheets don't auto-size to their List content; without an
        // explicit frame the sheet collapses to toolbar-height and the
        // sections are hidden.
        .frame(minWidth: 520, minHeight: 360)
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environment(AppModel.preview)
            .environment(RouterPath())
    }
}
