import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.routerPath) private var router
    @Environment(\.openWindow) private var openWindow
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
                    accounts: model.connectedAccounts,
                    activeAccountID: model.activeAccountID,
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
                    },
                    switchAccount: { accountID in
                        Task {
                            await model.switchGoogleAccount(to: accountID)
                        }
                    },
                    disconnectAccount: { accountID in
                        Task {
                            await model.disconnectGoogleAccount(id: accountID)
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
                        openWindow(id: "diagnostics")
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

                    Picker("Keep past events", selection: eventRetentionBinding) {
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                        Text("2 years").tag(730)
                        Text("Forever").tag(0)
                    }
                    .pickerStyle(.menu)

                    Picker("Keep completed tasks", selection: completedTaskRetentionBinding) {
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                        Text("2 years").tag(730)
                        Text("Forever").tag(0)
                    }
                    .pickerStyle(.menu)

                    Text("Older events and completed tasks are dropped from the local cache to keep memory + disk tight. Drops never touch Google — a Force Resync refetches according to these retention windows. Past cleanup on Google is a separate setting under \"Past cleanup\".")
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

            DataControlSection()

            LocalBackupSection()

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
                .disabled(model.settings.showMenuBarExtra == false)
                if model.settings.menuBarStyle == .adaptive {
                    adaptiveMenuBarControls
                }
                MenuBarIconPickerRow()
                .disabled(model.settings.showMenuBarExtra == false)
                Toggle("Menu bar badge for overdue tasks", isOn: menuBarBadgeBinding)
                    .disabled(model.settings.showMenuBarExtra == false)
                Toggle("Dock badge for overdue tasks", isOn: dockBadgeBinding)
            }

            UpdatesSection()

            AppVersionSection()

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
                    Text("Before you customize this list, Hot Cross Buns follows calendars selected in Google Calendar, including subscribed and read-only calendars.")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
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

    private var showCompletedItemsInCalendarBinding: Binding<Bool> {
        Binding(
            get: { model.settings.showCompletedItemsInCalendar },
            set: { model.setShowCompletedItemsInCalendar($0) }
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

    private var menuBarAdaptiveStatusSourceBinding: Binding<AppSettings.MenuBarAdaptiveStatusSource> {
        Binding(
            get: { model.settings.menuBarAdaptiveStatusSource },
            set: { model.setMenuBarAdaptiveStatusSource($0) }
        )
    }

    private var menuBarAdaptiveEmptyBehaviorBinding: Binding<AppSettings.MenuBarAdaptiveEmptyBehavior> {
        Binding(
            get: { model.settings.menuBarAdaptiveEmptyBehavior },
            set: { model.setMenuBarAdaptiveEmptyBehavior($0) }
        )
    }

    private var menuBarAdaptivePanelContentBinding: Binding<AppSettings.MenuBarAdaptivePanelContent> {
        Binding(
            get: { model.settings.menuBarAdaptivePanelContent },
            set: { model.setMenuBarAdaptivePanelContent($0) }
        )
    }

    @ViewBuilder
    private var adaptiveMenuBarControls: some View {
        Group {
            Picker("Status source", selection: menuBarAdaptiveStatusSourceBinding) {
                ForEach(AppSettings.MenuBarAdaptiveStatusSource.allCases, id: \.self) { source in
                    Text(source.title).tag(source)
                }
            }
            .pickerStyle(.menu)
            Picker("When empty", selection: menuBarAdaptiveEmptyBehaviorBinding) {
                ForEach(AppSettings.MenuBarAdaptiveEmptyBehavior.allCases, id: \.self) { behavior in
                    Text(behavior.title).tag(behavior)
                }
            }
            .pickerStyle(.menu)
            Picker("Panel contents", selection: menuBarAdaptivePanelContentBinding) {
                ForEach(AppSettings.MenuBarAdaptivePanelContent.allCases, id: \.self) { content in
                    Text(content.title).tag(content)
                }
            }
            .pickerStyle(.menu)
        }
        .disabled(model.settings.showMenuBarExtra == false)
    }

    private var eventRetentionBinding: Binding<Int> {
        Binding(
            get: { model.settings.eventRetentionDaysBack },
            set: { model.setEventRetentionDaysBack($0) }
        )
    }

    private var completedTaskRetentionBinding: Binding<Int> {
        Binding(
            get: { model.settings.completedTaskRetentionDaysBack },
            set: { model.setCompletedTaskRetentionDaysBack($0) }
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

struct MenuBarIconPickerLabel: View {
    let icon: AppSettings.MenuBarIcon

    var body: some View {
        HStack(spacing: 8) {
            MenuBarIconGlyph(icon: icon)
                .frame(width: 16, height: 16)
            Text(icon.title)
        }
    }
}

struct MenuBarIconGlyph: View {
    let icon: AppSettings.MenuBarIcon

    @ViewBuilder
    var body: some View {
        if let systemImageName = icon.systemImageName {
            Image(systemName: systemImageName)
                .symbolRenderingMode(.monochrome)
        } else {
            Image("MenuBarIcon")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
        }
    }
}

struct MenuBarIconPickerRow: View {
    @Environment(AppModel.self) private var model
    @State private var isShowingGrid = false

    private let columns = Array(repeating: GridItem(.fixed(74), spacing: 8), count: 5)

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Menu bar icon")
            Spacer(minLength: 16)
            MenuBarIconPickerLabel(icon: model.settings.menuBarIcon)
                .foregroundStyle(.secondary)
            Button("Change…") {
                isShowingGrid = true
            }
            .popover(isPresented: $isShowingGrid, arrowEdge: .bottom) {
                iconGrid
            }
        }
    }

    private var iconGrid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(AppSettings.MenuBarIcon.allCases) { icon in
                    Button {
                        model.setMenuBarIcon(icon)
                        isShowingGrid = false
                    } label: {
                        MenuBarIconGridCell(icon: icon, isSelected: model.settings.menuBarIcon == icon)
                    }
                    .buttonStyle(.plain)
                    .help(icon.title)
                }
            }
            .padding(12)
        }
        .frame(width: 410, height: 500)
    }
}

private struct MenuBarIconGridCell: View {
    let icon: AppSettings.MenuBarIcon
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 6) {
            MenuBarIconGlyph(icon: icon)
                .frame(width: 22, height: 22)
            Text(icon.gridTitle)
                .hcbFont(.caption2, weight: isSelected ? .semibold : .regular)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(height: 26)
        }
        .frame(width: 66, height: 62)
        .background(selectionBackground)
        .overlay(selectionBorder)
    }

    private var selectionBackground: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(isSelected ? Color.accentColor.opacity(0.18) : Color.clear)
    }

    private var selectionBorder: some View {
        RoundedRectangle(cornerRadius: 7)
            .strokeBorder(isSelected ? Color.accentColor : Color.secondary.opacity(0.35), lineWidth: 1)
    }
}

private extension AppSettings.MenuBarIcon {
    var gridTitle: String {
        switch self {
        case .calendarPlus: "Cal +"
        case .calendarMinus: "Cal -"
        case .calendarCircle: "Cal O"
        case .checkCircle: "Check O"
        case .checkSquare: "Check Sq"
        case .listRectangle: "List Box"
        case .textCheck: "Text"
        case .archiveBox: "Archive"
        case .shippingBox: "Ship"
        case .paperplane: "Plane"
        case .cloudSun: "Cloud Sun"
        case .mapPin: "Map Pin"
        default: title
        }
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
    let accounts: [GoogleAccount]
    let activeAccountID: GoogleAccount.ID?
    let canConnect: Bool
    let connect: () -> Void
    let disconnect: () -> Void
    let switchAccount: (GoogleAccount.ID) -> Void
    let disconnectAccount: (GoogleAccount.ID) -> Void

    @State private var confirmingDisconnectAccountID: GoogleAccount.ID?
    @State private var cacheFootprint = "Calculating..."

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            statusHeader
            authMessage
            Divider()
            identityProviderRow

            if displayAccounts.isEmpty == false {
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(displayAccounts) { account in
                        accountRow(account, isActive: account.id == resolvedActiveAccountID)
                    }
                }
            }

            if account != nil {
                Button(action: connect) {
                    Label("Add Google Account", systemImage: "person.crop.circle.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.ember)
                .hcbScaledFrame(maxWidth: 320, alignment: .leading)
                .disabled(isAuthenticating || canConnect == false)

                Button(role: .destructive) {
                    confirmingDisconnectAccountID = resolvedActiveAccountID
                } label: {
                    Label("Disconnect Active Account", systemImage: "person.crop.circle.badge.xmark")
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
            isPresented: Binding(
                get: { confirmingDisconnectAccountID != nil },
                set: { if $0 == false { confirmingDisconnectAccountID = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Disconnect Google", role: .destructive) {
                if let confirmingDisconnectAccountID {
                    disconnectAccount(confirmingDisconnectAccountID)
                } else {
                    disconnect()
                }
                confirmingDisconnectAccountID = nil
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(disconnectConfirmationMessage)
        }
    }

    private var statusHeader: some View {
        HStack {
            Label(statusTitle, systemImage: iconName)
                .hcbFont(.headline)
            Spacer()
            if case .authenticating = authState {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }

    @ViewBuilder
    private var authMessage: some View {
        if case .failed(let message) = authState {
            Text(message)
                .hcbFont(.footnote)
                .foregroundStyle(.red)
        } else if case .cancelled(let message) = authState {
            Text(message)
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var identityProviderRow: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "globe")
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text("Google")
                    .hcbFont(.subheadline, weight: .semibold)
                Text(identityProviderDetail)
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    private func accountRow(_ account: GoogleAccount, isActive: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.crop.circle.fill")
                .foregroundStyle(isActive ? AppColor.moss : .secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(account.displayName)
                        .hcbFont(.subheadline, weight: .semibold)
                        .lineLimit(1)
                    if isActive {
                        Text("Active")
                            .hcbFont(.caption2, weight: .semibold)
                            .foregroundStyle(AppColor.moss)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(AppColor.moss.opacity(0.14)))
                    }
                }
                Text(account.email)
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(scopeSummary(for: account))
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if isActive == false {
                Button {
                    switchAccount(account.id)
                } label: {
                    Label("Switch Account", systemImage: "arrow.left.arrow.right")
                }
                .buttonStyle(.bordered)
                .help("Make this the active Google account")
            }
            Button(role: .destructive) {
                confirmingDisconnectAccountID = account.id
            } label: {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.borderless)
            .help("Disconnect this Google account")
        }
        .hcbScaledPadding(.vertical, 3)
    }

    private var statusTitle: String {
        if account != nil {
            return "Connected"
        }
        return authState.title
    }

    private var identityProviderDetail: String {
        if let account {
            return "Identity provider - \(account.authProvider.title)"
        }
        return canConnect ? "Identity provider ready" : "Desktop OAuth client required"
    }

    private var isAuthenticating: Bool {
        if case .authenticating = authState {
            return true
        }
        return false
    }

    private var displayAccounts: [GoogleAccount] {
        var seen: Set<GoogleAccount.ID> = []
        var ordered: [GoogleAccount] = []
        if let account {
            ordered.append(account)
            seen.insert(account.id)
        }
        for account in accounts where seen.insert(account.id).inserted {
            ordered.append(account)
        }
        return ordered
    }

    private var resolvedActiveAccountID: GoogleAccount.ID? {
        activeAccountID ?? account?.id
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
            disconnectImpactResolver.cacheInvalidationKey
        ].joined(separator: ":")
    }

    private var disconnectConfirmationMessage: String {
        let targetID = confirmingDisconnectAccountID ?? account?.id
        let targetAccount = targetID.flatMap { id in displayAccounts.first { $0.id == id } } ?? account
        return disconnectImpactResolver.summary(
            for: targetID,
            accountName: targetAccount?.displayName ?? "this Google account",
            cacheFootprint: cacheFootprint
        ).confirmationMessage
    }

    private var disconnectImpactResolver: AccountDisconnectImpactResolver {
        AccountDisconnectImpactResolver(
            activeAccountID: resolvedActiveAccountID,
            activePendingMutations: model.pendingMutations,
            accountWorkspaces: model.accountWorkspaces
        )
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
