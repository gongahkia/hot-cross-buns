import AppKit
import ServiceManagement
import SwiftUI
import UniformTypeIdentifiers
import UserNotifications

struct GeneralSection: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var vm: SettingsViewModel

    @State private var notificationsStatus: UNAuthorizationStatus = .notDetermined
    @State private var choosingDefaultLocation = false
    @State private var loginItemError: String?

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Storage") {
                InfoRow(title: "Cache root", value: session.cacheRoot, monospacedValue: true)
                InfoRow(title: "Credentials", value: session.credentialsPath, monospacedValue: true)
                LabeledContent("Default new-doc location") {
                    HStack {
                        Text(defaultLocationLabel)
                            .foregroundStyle(vm.settings.mac.defaultNewDocLocation.isEmpty ? .secondary : .primary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Button("Choose...") {
                            choosingDefaultLocation = true
                        }
                    }
                }
            }

            Section("Startup") {
                Toggle("Open Melon Pan at login", isOn: openAtLoginBinding)
                if let loginItemError {
                    Text(loginItemError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                Toggle("Show menu bar item", isOn: showMenuBarItemBinding)
            }

            Section("Safety") {
                Toggle("Confirm before delete", isOn: vm.macBinding(\.confirmBeforeDelete))
            }

            Section("Notifications") {
                InfoRow(title: "Status", value: notificationsStatusText)
                if notificationsStatus == .denied {
                    Button("Open in System Settings") {
                        openNotificationSettings()
                    }
                }
            }
        }
        .formStyle(.grouped)
        .padding(16)
        .fileImporter(
            isPresented: $choosingDefaultLocation,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let url = urls.first {
                vm.updateMac(\.defaultNewDocLocation, url.path)
            }
        }
        .task {
            await refreshNotificationStatus()
            refreshOpenAtLoginStatus()
            session.showMenuBarItem = vm.settings.mac.showMenuBarItem
        }
        .onReceive(NotificationCenter.default.publisher(
            for: NSApplication.didBecomeActiveNotification
        )) { _ in
            Task {
                await refreshNotificationStatus()
                refreshOpenAtLoginStatus()
            }
        }
    }

    private var defaultLocationLabel: String {
        vm.settings.mac.defaultNewDocLocation.isEmpty
            ? "Not set"
            : vm.settings.mac.defaultNewDocLocation
    }

    private var showMenuBarItemBinding: Binding<Bool> {
        Binding(
            get: { vm.settings.mac.showMenuBarItem },
            set: { value in
                vm.updateMac(\.showMenuBarItem, value)
                session.showMenuBarItem = value
            }
        )
    }

    private var openAtLoginBinding: Binding<Bool> {
        Binding(
            get: { vm.settings.mac.openAtLogin },
            set: { enabled in
                setOpenAtLogin(enabled)
            }
        )
    }

    private var notificationsStatusText: String {
        switch notificationsStatus {
        case .authorized:
            return "Enabled"
        case .denied:
            return "Disabled"
        case .notDetermined:
            return "Not Asked"
        case .provisional:
            return "Enabled (Provisional)"
        case .ephemeral:
            return "Enabled (Ephemeral)"
        @unknown default:
            return "Unknown"
        }
    }

    private func refreshNotificationStatus() async {
        notificationsStatus = await AppNotifications.currentAuthorizationStatus()
    }

    private func refreshOpenAtLoginStatus() {
        vm.refreshMacValue(\.openAtLogin, SMAppService.mainApp.status == .enabled)
    }

    private func setOpenAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            loginItemError = nil
            vm.updateMac(\.openAtLogin, enabled)
        } catch {
            loginItemError = "\(error)"
            vm.refreshMacValue(\.openAtLogin, SMAppService.mainApp.status == .enabled)
        }
    }

    private func openNotificationSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications") else {
            return
        }
        NSWorkspace.shared.open(url)
    }
}
