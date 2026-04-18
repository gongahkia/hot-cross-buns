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
            }

            Section("Calendars") {
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
        .appBackground()
        .navigationTitle("Settings")
    }

    private var syncModeBinding: Binding<SyncMode> {
        Binding(
            get: { model.settings.syncMode },
            set: { model.updateSyncMode($0) }
        )
    }

    private func calendarBinding(_ id: CalendarListMirror.ID) -> Binding<Bool> {
        Binding(
            get: { model.calendars.first(where: { $0.id == id })?.isSelected ?? false },
            set: { _ in model.toggleCalendar(id) }
        )
    }
}

private extension View {
    @ViewBuilder
    func syncModePickerStyle() -> some View {
        #if os(macOS)
        self.pickerStyle(.menu)
        #else
        self.pickerStyle(.navigationLink)
        #endif
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
                    Text("Manual only refreshes on request. Balanced refreshes on launch and foreground. Near real-time adds foreground polling every 90 seconds. True push on iOS would need a webhook-to-APNs relay later.")
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
