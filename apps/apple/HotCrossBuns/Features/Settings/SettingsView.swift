import GoogleSignInSwift
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(RouterPath.self) private var router

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
                        .onTapGesture { model.resetOnboarding() }
                }
            }

            Section("Notifications") {
                Toggle("Local reminders", isOn: localNotificationsBinding)
                Text("Schedules up to 64 pending reminders for due tasks and upcoming events on this device.")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }

            AppearanceSection()

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
        .navigationTitle("Settings")
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
