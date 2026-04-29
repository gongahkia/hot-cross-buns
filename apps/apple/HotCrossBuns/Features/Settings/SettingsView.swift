import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @State private var permissionPrimer: PermissionPrimer?
    @State private var showLocalNotificationsInfo = false
    @State private var showNotificationsDeniedAlert = false
    @State private var showOnboardingResetConfirmed = false

    var body: some View {
        List {
            Section("Google OAuth client") {
                GoogleOAuthClientSetupView()
            }

            Section("Google account") {
                AccountStatusView(
                    authState: model.authState,
                    account: model.account,
                    canConnect: model.isGoogleAuthConfigured,
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

                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(SyncMode.allCases) { mode in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: mode == model.settings.syncMode ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(mode == model.settings.syncMode ? AppColor.moss : .secondary)
                                Text("\(mode.title): \(mode.guidance)")
                                    .hcbFont(.caption)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }

                    Button {
                        router?.present(.syncSettings)
                    } label: {
                        Label("Sync details", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)

                    Button {
                        router?.present(.diagnostics)
                    } label: {
                        Label("Diagnostics and recovery", systemImage: "stethoscope")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)

                    Button {
                        model.resetOnboarding()
                        showOnboardingResetConfirmed = true
                    } label: {
                        Label("Run setup again", systemImage: "sparkles")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)

                    Picker("Local cache retention (Google untouched)", selection: eventRetentionBinding) {
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                        Text("2 years").tag(730)
                        Text("Forever").tag(0)
                    }
                    .pickerStyle(.menu)
                    Text("Older events are dropped from the local cache to keep memory + disk tight. Drops never touch Google — a Force Resync refetches everything. Recently-edited events (within the window) are preserved even if they ended earlier. Past-event cleanup on Google is a separate setting under \"Past cleanup\".")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Notifications") {
                Toggle("Local reminders", isOn: localNotificationsBinding)
                if model.settings.enableLocalNotifications {
                    Picker("Remind me before due", selection: taskReminderThresholdBinding) {
                        Text("Disabled").tag(0)
                        Text("1 day before").tag(1)
                        Text("3 days before").tag(3)
                        Text("1 week before").tag(7)
                        Text("2 weeks before").tag(14)
                        Text("1 month before").tag(30)
                    }
                    .pickerStyle(.menu)
                    if model.settings.taskReminderThresholdDays > 0 {
                        DatePicker("Fire at", selection: taskReminderTimeBinding, displayedComponents: [.hourAndMinute])
                        Text("Every open task with a due date fires a single notification on this Mac at the chosen time, N days before. Per-task offsets are not stored anywhere — the rule is app-wide.")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            CompletionSoundSection()

            AppearanceSection()

            PerSurfaceFontSection()

            LayoutSection()

            EncryptionSection()

            KeybindingsSection()

            OpenAtLoginSection()

            Section("Mac surfaces") {
                Toggle("Menu bar extra", isOn: menuBarExtraBinding)
                Picker("Menu bar panel", selection: menuBarStyleBinding) {
                    ForEach(AppSettings.MenuBarStyle.allCases, id: \.self) { style in
                        Text(style.title).tag(style)
                    }
                }
                .pickerStyle(.menu)
                Toggle("Menu bar badge for overdue tasks", isOn: menuBarBadgeBinding)
                    .disabled(model.settings.showMenuBarExtra == false)
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

            GlobalHotkeySection()

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

            PerTabListFilterSection()

            ColorTagBindingsSection()

            PastCleanupSection()
        }
        .appBackground()
        .sheet(item: $permissionPrimer) { primer in
            PermissionPrimerView(primer: primer) {
                permissionPrimer = nil
                Task {
                    let result = await model.requestEnableLocalNotifications()
                    await MainActor.run {
                        if result == .authorized {
                            showLocalNotificationsInfo = true
                        } else {
                            showNotificationsDeniedAlert = true
                        }
                    }
                }
            } onCancel: {
                permissionPrimer = nil
            }
        }
        .alert("Local reminders enabled", isPresented: $showLocalNotificationsInfo) {
            Button("OK") { showLocalNotificationsInfo = false }
        } message: {
            Text("Hot Cross Buns will schedule up to 64 pending reminders on this Mac for the soonest-upcoming due tasks and Calendar events. 64 is an Apple-imposed ceiling for local notifications per app — later items get scheduled automatically as earlier ones fire or complete.")
        }
        .alert("Notifications are off for Hot Cross Buns", isPresented: $showNotificationsDeniedAlert) {
            Button("Open Notifications Settings") {
                HotCrossBunsSystemSettings.open(HotCrossBunsSystemSettings.notificationsURL)
            }
            Button("Cancel", role: .cancel) {
                showNotificationsDeniedAlert = false
            }
        } message: {
            Text("macOS blocked notifications for Hot Cross Buns. Open System Settings > Notifications > Hot Cross Buns to allow device-local reminders.")
        }
        .alert("Setup will run now", isPresented: $showOnboardingResetConfirmed) {
            Button("OK") { showOnboardingResetConfirmed = false }
        } message: {
            Text("The onboarding flow has been reset. Switch back to the main Hot Cross Buns window to go through setup again.")
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
            set: { newValue in
                if newValue {
                    permissionPrimer = .notifications
                } else {
                    model.updateLocalNotificationsEnabled(false)
                }
            }
        )
    }

    private var taskReminderThresholdBinding: Binding<Int> {
        Binding(
            get: { model.settings.taskReminderThresholdDays },
            set: { model.setTaskReminderThresholdDays($0) }
        )
    }

    private var taskReminderTimeBinding: Binding<Date> {
        Binding(
            get: {
                var comps = DateComponents()
                comps.hour = model.settings.taskReminderHour
                comps.minute = model.settings.taskReminderMinute
                return Calendar.current.date(from: comps) ?? Date()
            },
            set: { newValue in
                let comps = Calendar.current.dateComponents([.hour, .minute], from: newValue)
                model.setTaskReminderTime(hour: comps.hour ?? 9, minute: comps.minute ?? 0)
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

    private var menuBarBadgeBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showMenuBarBadge },
            set: { model.setShowMenuBarBadge($0) }
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

struct AccountStatusView: View {
    @Environment(AppModel.self) private var model
    let authState: AuthState
    let account: GoogleAccount?
    let canConnect: Bool
    let connect: () -> Void
    let disconnect: () -> Void

    @State private var isConfirmingDisconnect = false
    @State private var cacheFootprint = "Calculating..."

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
            } else if case .cancelled(let message) = authState {
                Text(message)
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let account {
                Text(account.displayName)
                    .hcbFont(.subheadline, weight: .medium)
                Text(scopeSummary(for: account))
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
                Text("Auth provider: \(account.authProvider.title)")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)

                Button(role: .destructive) {
                    isConfirmingDisconnect = true
                } label: {
                    Text("Disconnect Google")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else {
                Button(action: connect) {
                    Label("Connect Google", systemImage: "person.crop.circle.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.ember)
                    .hcbScaledFrame(maxWidth: 320, alignment: .leading)
                    .disabled(isAuthenticating || canConnect == false)
                if canConnect == false {
                    Text("Save a desktop OAuth client above, or build the app with an embedded Google Sign-In client.")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .hcbScaledPadding(.vertical, 6)
        .task(id: disconnectImpactID) {
            cacheFootprint = await model.cacheFootprintDescription()
        }
        .confirmationDialog(
            "Disconnect Google?",
            isPresented: $isConfirmingDisconnect,
            titleVisibility: .visible
        ) {
            Button("Disconnect Google", role: .destructive, action: disconnect)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(disconnectConfirmationMessage)
        }
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
        case .cancelled:
            "info.circle"
        case .failed:
            "exclamationmark.triangle"
        case .signedOut:
            "person.crop.circle.badge.plus"
        }
    }

    private var disconnectImpactID: String {
        [
            account?.id ?? "signed-out",
            String(model.pendingMutations.count),
            String(model.conflictedMutationCount),
            String(model.quarantinedMutationCount),
            String(model.invalidPayloadMutationCount)
        ].joined(separator: ":")
    }

    private var disconnectConfirmationMessage: String {
        let pendingCount = model.pendingMutations.count
        let pendingNoun = pendingCount == 1 ? "queued local write" : "queued local writes"
        var lines = [
            "This signs out \(account?.displayName ?? "this Google account") on this Mac and stops syncing until you connect again.",
            "Google Tasks and Calendar data in your Google account will not be deleted.",
            "Local cache on disk: \(cacheFootprint).",
            "Pending sync work: \(pendingCount) \(pendingNoun)."
        ]

        let flagged = disconnectFlaggedMutationSummary
        if flagged.isEmpty == false {
            lines.append("Needs attention: \(flagged).")
        }

        if pendingCount > 0 {
            lines.append("Queued writes remain local, but they cannot reach Google while disconnected.")
        }

        return lines.joined(separator: "\n\n")
    }

    private var disconnectFlaggedMutationSummary: String {
        var parts: [String] = []
        if model.conflictedMutationCount > 0 {
            parts.append("\(model.conflictedMutationCount) conflict\(model.conflictedMutationCount == 1 ? "" : "s")")
        }
        if model.quarantinedMutationCount > 0 {
            parts.append("\(model.quarantinedMutationCount) quarantined")
        }
        if model.invalidPayloadMutationCount > 0 {
            parts.append("\(model.invalidPayloadMutationCount) invalid")
        }
        return parts.joined(separator: ", ")
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
            .environment(\.routerPath, RouterPath())
    }
}
