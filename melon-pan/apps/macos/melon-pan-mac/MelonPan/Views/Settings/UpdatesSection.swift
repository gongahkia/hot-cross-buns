import SwiftUI

struct UpdatesSection: View {
    @ObservedObject var vm: SettingsViewModel
    @State private var checking = false
    @State private var status: RuntimeBridge.UpdateStatus?
    @State private var error: String?

    private var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
            ?? "0.0.0"
    }

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Updates") {
                LabeledContent("Current version", value: currentVersion)
                LabeledContent("Last check", value: lastCheckText)
                Toggle("Automatically check for updates", isOn: vm.macBinding(\.updaterAutoCheck))
                Picker("Sparkle channel", selection: vm.macBinding(\.updaterChannel)) {
                    Text("Stable").tag("stable")
                    Text("Beta").tag("beta")
                }
                .disabled(true)
                Text("MELON_PAN_SETTINGS_STUB: Sparkle is deferred; channel is stored for the future updater.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let status {
                    LabeledContent("Latest", value: status.latest)
                    if status.hasUpdate {
                        HStack {
                            Label("Update available", systemImage: "arrow.up.circle.fill")
                                .foregroundStyle(.orange)
                            Spacer()
                            Button("Open release page") {
                                RuntimeBridge.openURL(status.releaseUrl)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    } else {
                        Label("Up to date", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                } else if !checking && error == nil {
                    Text("Click Check for Updates to query GitHub Releases.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if checking {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("Checking...")
                            .font(.caption)
                    }
                }
                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                Button("Check for Updates") {
                    runCheck()
                }
                .disabled(checking)
            }
        }
        .formStyle(.grouped)
        .padding(16)
    }

    private var lastCheckText: String {
        guard vm.settings.mac.lastUpdateCheckUnix > 0 else { return "Never" }
        let date = Date(timeIntervalSince1970: TimeInterval(vm.settings.mac.lastUpdateCheckUnix))
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func runCheck() {
        checking = true
        error = nil
        let version = currentVersion
        Task.detached(priority: .userInitiated) {
            do {
                let outcome = try RuntimeBridge.checkForUpdates(
                    repo: nil,
                    currentVersion: version
                )
                await MainActor.run {
                    status = outcome
                    checking = false
                    vm.updateMac(\.lastUpdateCheckUnix, UInt64(Date().timeIntervalSince1970))
                    if outcome.hasUpdate {
                        AppStatusCenter.shared.postUpdateAvailable(
                            latestVersion: outcome.latest,
                            releaseUrl: outcome.releaseUrl
                        )
                        AppNotifications.notifyUpdateAvailable(
                            latestVersion: outcome.latest
                        )
                    }
                }
            } catch {
                await MainActor.run {
                    self.error = "\(error)"
                    checking = false
                    vm.updateMac(\.lastUpdateCheckUnix, UInt64(Date().timeIntervalSince1970))
                }
            }
        }
    }
}
