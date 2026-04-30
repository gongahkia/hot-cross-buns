import GoogleSignInSwift
import SwiftUI

// Top-level detached Settings window. Opened via the Settings scene in
// HotCrossBunsApp.swift (⌘, auto-wired by macOS). Layout matches Apple
// Calendar / Mail — a top tab bar with focused categories, content below.
// Most tabs host a scrollable Form of the section views HCB already
// ships; wider tool panes such as Hotkeys can use their own layout.
// The main app sidebar no longer carries a Settings tab; all preferences
// live here.
struct HCBSettingsWindow: View {
    @Environment(AppModel.self) private var model
    @Environment(UpdaterController.self) private var updater
    @Environment(\.openWindow) private var openWindow
    private enum Tab: String, CaseIterable, Identifiable {
        case general, appearance, hotkeys, alerts, advanced
        var id: String { rawValue }

        var title: String {
            switch self {
            case .general: "General"
            case .appearance: "Appearance"
            case .hotkeys: "Hotkeys"
            case .alerts: "Alerts"
            case .advanced: "Advanced"
            }
        }

        var systemImage: String {
            switch self {
            case .general: "gearshape"
            case .appearance: "paintbrush"
            case .hotkeys: "keyboard"
            case .alerts: "bell"
            case .advanced: "gearshape.2"
            }
        }
    }

    @State private var tab: Tab = .general
    // Sub-sheets hosted locally (the detached window has no RouterPath).
    @State private var isSyncDetailsPresented = false
    @State private var isDiagnosticsPresented = false

    var body: some View {
        TabView(selection: $tab) {
            GeneralTab(
                isSyncDetailsPresented: $isSyncDetailsPresented,
                isDiagnosticsPresented: $isDiagnosticsPresented
            )
            .tabItem { Label("General", systemImage: "gearshape") }
            .tag(Tab.general)

            AppearanceTab()
            .tabItem { Label("Appearance", systemImage: "paintbrush") }
            .tag(Tab.appearance)

            HotkeysTab()
            .tabItem { Label("Hotkeys", systemImage: "keyboard") }
            .tag(Tab.hotkeys)

            AlertsTab()
            .tabItem { Label("Alerts", systemImage: "bell") }
            .tag(Tab.alerts)

            AdvancedTab()
            .tabItem { Label("Advanced", systemImage: "gearshape.2") }
            .tag(Tab.advanced)
        }
        // Hotkeys needs a two-column settings surface, so the detached
        // settings window gets a wider default while remaining resizable.
        .frame(minWidth: 680, idealWidth: 820, minHeight: 560, idealHeight: 640)
        // The Settings scene is a separate SwiftUI Scene, so the
        // appearance environment applied in MacSidebarShell doesn't
        // carry through — re-apply here so the color scheme, dark/light
        // mode, scaled fonts, and background match the main window.
        .id(model.settings.colorSchemeID)
        .withHCBAppearance(model.settings)
        .environment(\.hcbShortcutOverrides, model.settings.shortcutOverrides)
        .hcbPreferredColorScheme(model.settings)
        .appBackground()
        .navigationTitle(tab.title)
        .sheet(isPresented: $isSyncDetailsPresented) {
            SyncSettingsSheet()
                .environment(model)
                .withHCBAppearance(model.settings)
                .hcbPreferredColorScheme(model.settings)
        }
        .sheet(isPresented: $isDiagnosticsPresented) {
            DiagnosticsView()
                .environment(model)
                .withHCBAppearance(model.settings)
                .hcbPreferredColorScheme(model.settings)
        }
        .overlay {
            BulkResultToast(
                message: Binding(
                    get: { updater.toastState?.message },
                    set: { newValue in
                        if newValue == nil {
                            updater.clearToast()
                        }
                    }
                ),
                isWarning: updater.toastState?.isWarning ?? false,
                successTitle: updater.toastState?.title ?? "Update check complete",
                warningTitle: updater.toastState?.title ?? "Update check failed",
                successSymbol: "arrow.down.circle.fill",
                warningSymbol: "wifi.exclamationmark"
            )
        }
        .onChange(of: updater.updatePromptSequence) { _, _ in
            openWindow(id: "update-available")
        }
        .onChange(of: updater.installGuideSequence) { _, _ in
            openWindow(id: "install-update")
        }
    }

}

// MARK: - General tab

private struct GeneralTab: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Binding var isSyncDetailsPresented: Bool
    @Binding var isDiagnosticsPresented: Bool
    @State private var showOnboardingResetConfirmed = false
    @State private var customRetentionAmount: Int = 60
    @State private var customRetentionUnit: RetentionUnit = .days

    enum RetentionUnit: String, CaseIterable, Identifiable {
        case days, weeks, years
        var id: String { rawValue }
        var title: String {
            switch self {
            case .days: "Days"
            case .weeks: "Weeks"
            case .years: "Years"
            }
        }
        func toDays(_ amount: Int) -> Int {
            switch self {
            case .days: amount
            case .weeks: amount * 7
            case .years: amount * 365
            }
        }
    }

    var body: some View {
        Form {
            Section("Google OAuth client") {
                GoogleOAuthClientSetupView()
            }

            Section("Google account") {
                AccountStatusView(
                    authState: model.authState,
                    account: model.account,
                    canConnect: model.isGoogleAuthConfigured,
                    connect: { Task { await model.connectGoogleAccount() } },
                    disconnect: { Task { await model.disconnectGoogleAccount() } }
                )
            }

            OpenAtLoginSection()

            if model.account != nil {
                Section("Sync") {
                    Picker("Mode", selection: syncModeBinding) {
                        ForEach(SyncMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    Text(model.settings.syncMode.detail)
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                    syncModeGuidance
                    Picker("Keep past events", selection: eventRetentionBinding) {
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                        Text("2 years").tag(730)
                        Text("Forever").tag(0)
                    }
                    HStack(spacing: 8) {
                        Text("Custom")
                            .frame(maxWidth: .infinity, alignment: .leading)
                        TextField("Amount", value: $customRetentionAmount, format: .number)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 70)
                            .multilineTextAlignment(.trailing)
                        Picker("Unit", selection: $customRetentionUnit) {
                            ForEach(RetentionUnit.allCases) { unit in
                                Text(unit.title).tag(unit)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 90)
                        Button("Apply") {
                            let days = customRetentionUnit.toDays(max(0, customRetentionAmount))
                            model.setEventRetentionDaysBack(days)
                        }
                        .disabled(customRetentionAmount <= 0)
                    }
                    Text("Older events are dropped from the local cache to keep memory + disk tight. Drops never touch Google — a Force Resync refetches everything.")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)

                    if hasSyncAttentionItems {
                        Button {
                            openWindow(id: "sync-issues")
                        } label: {
                            Label(syncAttentionLabel, systemImage: "exclamationmark.bubble")
                        }
                    }
                }

                Section("Setup") {
                    Button {
                        model.resetOnboarding()
                        showOnboardingResetConfirmed = true
                    } label: {
                        Label("Run setup again", systemImage: "sparkles")
                    }
                }
                .alert("Setup will run now", isPresented: $showOnboardingResetConfirmed) {
                    Button("OK") { showOnboardingResetConfirmed = false }
                } message: {
                    Text("The onboarding flow has been reset. Switch back to the main Hot Cross Buns window to go through setup again.")
                }
            }
        }
        .formStyle(.grouped)
    }

    private var syncModeBinding: Binding<SyncMode> {
        Binding(
            get: { model.settings.syncMode },
            set: { model.updateSyncMode($0) }
        )
    }

    private var eventRetentionBinding: Binding<Int> {
        Binding(
            get: { model.settings.eventRetentionDaysBack },
            set: { model.setEventRetentionDaysBack($0) }
        )
    }

    private var syncModeGuidance: some View {
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
    }

    private var hasSyncAttentionItems: Bool {
        model.conflictedMutationCount > 0
            || model.quarantinedMutationCount > 0
            || (model.lastNotificationScheduleSummary?.hasDeferred ?? false)
    }

    private var syncAttentionLabel: String {
        var parts: [String] = []
        if model.conflictedMutationCount > 0 {
            parts.append("\(model.conflictedMutationCount) conflict\(model.conflictedMutationCount == 1 ? "" : "s")")
        }
        if model.quarantinedMutationCount > 0 {
            parts.append("\(model.quarantinedMutationCount) queued write\(model.quarantinedMutationCount == 1 ? "" : "s")")
        }
        if let summary = model.lastNotificationScheduleSummary, summary.hasDeferred {
            let total = summary.deferredEvents + summary.deferredTasks
            parts.append("\(total) deferred reminder\(total == 1 ? "" : "s")")
        }
        return "Review sync issues: " + parts.joined(separator: " • ")
    }
}

// MARK: - Appearance tab

private struct AppearanceTab: View {
    var body: some View {
        Form {
            AppearanceSection()
            PerSurfaceFontSection()
            LayoutSection()
        }
        .formStyle(.grouped)
    }
}

// MARK: - Hotkeys tab

private struct HotkeysTab: View {
    var body: some View {
        ScrollView {
            KeybindingsSection()
                .hcbScaledPadding(20)
        }
    }
}

// MARK: - Alerts tab

private struct AlertsTab: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @State private var permissionPrimer: PermissionPrimer?
    @State private var showLocalNotificationsInfo = false
    @State private var showNotificationsDeniedAlert = false

    var body: some View {
        Form {
            Section("Notifications") {
                Toggle("Local reminders", isOn: localNotificationsBinding)
                if model.settings.enableLocalNotifications {
                    taskReminderControls
                    if let summary = model.lastNotificationScheduleSummary, summary.hasDeferred {
                        Button {
                            openWindow(id: "sync-issues")
                        } label: {
                            Label(reminderCapacityLabel(summary), systemImage: "bell.badge")
                        }
                    }
                }
            }

            CompletionSoundSection()

            Section("Menu bar") {
                Toggle("Menu bar extra", isOn: menuBarExtraBinding)
                Picker("Menu bar panel", selection: menuBarStyleBinding) {
                    ForEach(AppSettings.MenuBarStyle.allCases, id: \.self) { style in
                        Text(style.title).tag(style)
                    }
                }
                Toggle("Menu bar badge for overdue tasks", isOn: menuBarBadgeBinding)
                    .disabled(model.settings.showMenuBarExtra == false)
            }

            Section("Dock") {
                Toggle("Dock badge for overdue tasks", isOn: dockBadgeBinding)
            }

            GlobalHotkeySection()
        }
        .formStyle(.grouped)
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

    private var menuBarExtraBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showMenuBarExtra },
            set: { model.setShowMenuBarExtra($0) }
        )
    }

    private var menuBarStyleBinding: Binding<AppSettings.MenuBarStyle> {
        Binding(
            get: { model.settings.menuBarStyle },
            set: { model.setMenuBarStyle($0) }
        )
    }

    private var menuBarBadgeBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showMenuBarBadge },
            set: { model.setShowMenuBarBadge($0) }
        )
    }

    private var dockBadgeBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showDockBadge },
            set: { model.setShowDockBadge($0) }
        )
    }

    // App-wide task reminder controls. Threshold = how many days before a task's
    // due date to fire a local notification. Time = hour:minute it fires at.
    // Per-task reminder offsets are gone: Google Tasks API has no reminder field.
    @ViewBuilder
    private var taskReminderControls: some View {
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
            DatePicker(
                "Fire at",
                selection: taskReminderTimeBinding,
                displayedComponents: [.hourAndMinute]
            )
            Text("Every open task with a due date fires a single notification on this Mac at the chosen time, `N` days before. Per-task offsets are not stored anywhere — the rule is app-wide.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
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

    private func reminderCapacityLabel(_ summary: NotificationScheduleSummary) -> String {
        let total = summary.deferredEvents + summary.deferredTasks
        return "Review \(total) deferred reminder\(total == 1 ? "" : "s")"
    }
}

// MARK: - Advanced tab

private struct AdvancedTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            Section("Calendars") {
                Toggle("Show completed tasks and dismissed events in calendar views", isOn: showCompletedItemsInCalendarBinding)
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

            DataControlSection()
            LocalBackupSection()
            EncryptionSection()
            HistorySection()
            CustomFiltersSection()
            TemplatesSection()
            UpdatesSection()
        }
        .formStyle(.grouped)
    }

    private func calendarBinding(_ id: CalendarListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.calendars.first(where: { $0.id == id })?.isSelected ?? false },
            set: { _ in model.toggleCalendar(id) }
        )
    }

    private var showCompletedItemsInCalendarBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showCompletedItemsInCalendar },
            set: { model.setShowCompletedItemsInCalendar($0) }
        )
    }

    private func taskListBinding(_ id: TaskListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.isTaskListSelected(id) },
            set: { _ in model.toggleTaskList(id) }
        )
    }
}

#Preview {
    HCBSettingsWindow()
        .environment(AppModel.preview)
}
