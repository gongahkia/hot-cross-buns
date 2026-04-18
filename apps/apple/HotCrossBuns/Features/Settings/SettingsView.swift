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

            Section("Sync") {
                Picker("Mode", selection: syncModeBinding) {
                    ForEach(SyncMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .syncModePickerStyle()

                Text(model.settings.syncMode.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    router.present(.syncSettings)
                } label: {
                    Label("Sync details", systemImage: "arrow.triangle.2.circlepath")
                }

                Button {
                    router.present(.diagnostics)
                } label: {
                    Label("Diagnostics and recovery", systemImage: "stethoscope")
                }

                Button {
                    model.resetOnboarding()
                } label: {
                    Label("Run setup again", systemImage: "sparkles")
                }
            }

            Section("Notifications") {
                Toggle("Local reminders", isOn: localNotificationsBinding)
                Text("Schedules up to 64 pending reminders for due tasks and upcoming events on this device.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Mac surfaces") {
                Toggle("Menu bar extra", isOn: menuBarExtraBinding)
                Toggle("Detailed menu bar panel", isOn: detailedMenuBarBinding)
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
                                    .frame(width: 10, height: 10)
                                Text(calendar.summary)
                            }
                        }
                    }
                }
            }

            Section("Keyboard") {
                Toggle("Vim keybindings", isOn: vimBinding)
                Text("Modal navigation in lists and sidebar. j/k move, gg top, G bottom, x toggle complete, dd delete, : command palette, / search. Text editors keep native shortcuts.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

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

    private var vimBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableVimKeybindings },
            set: { model.setEnableVimKeybindings($0) }
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
                    .font(.headline)
                Spacer()
                if case .authenticating = authState {
                    ProgressView()
                }
            }

            if case .failed(let message) = authState {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            if let account {
                Text(account.displayName)
                    .font(.subheadline.weight(.medium))
                Text(scopeSummary(for: account))
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button(role: .destructive, action: disconnect) {
                    Text("Disconnect Google")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else {
                GoogleSignInButton(action: connect)
                    .frame(maxWidth: 320, alignment: .leading)
                    .disabled(isAuthenticating)
            }
        }
        .padding(.vertical, 6)
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
                        .font(.headline)
                    Text(model.settings.syncMode.detail)
                        .foregroundStyle(.secondary)
                }

                Section("Reality check") {
                    Text("Manual only refreshes on request. Balanced refreshes on launch and foreground. Near real-time adds foreground polling every 90 seconds with backoff on rate-limits.")
                        .font(.callout)
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
