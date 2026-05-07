import SwiftUI

struct PrivacySection: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var vm: SettingsViewModel

    @State private var sheet: Sheet?
    @State private var encryptionStatus: String?

    private enum Sheet: Identifiable {
        case enable, disable, change
        var id: String {
            switch self {
            case .enable: return "enable"
            case .disable: return "disable"
            case .change: return "change"
            }
        }
    }

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Privacy") {
                Toggle("Local-first privacy", isOn: vm.binding(\.privacyLocalFirst))
                Text("Keeps local Markdown and metadata on this Mac unless you explicitly sync through Google.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Local cache encryption") {
                Toggle(isOn: encryptionBinding) {
                    Label(
                        "Encrypt local cache",
                        systemImage: vm.settings.mac.cacheEncryptionEnabled ? "lock.fill" : "lock.open"
                    )
                }
                if vm.settings.mac.cacheEncryptionEnabled {
                    Button {
                        sheet = .change
                    } label: {
                        Label("Change passphrase...", systemImage: "key.horizontal")
                    }
                }
                Text("MELON_PAN_SETTINGS_STUB: encryption UI is wired, but the Rust core encryption backend is deferred; re-key is a no-op stub.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let encryptionStatus {
                    Text(encryptionStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Local backups") {
                Toggle("Daily local backup", isOn: vm.macBinding(\.localBackupEnabled))
                Text("MELON_PAN_SETTINGS_STUB: the daily schedule is persisted but not scheduled yet; use Back up now for v1.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Stepper(value: vm.macBinding(\.localBackupRetentionCount), in: 1...90) {
                    LabeledContent("Keep backups", value: "\(vm.settings.mac.localBackupRetentionCount)")
                }
                .disabled(!vm.settings.mac.localBackupEnabled)
                HStack {
                    Button {
                        vm.runBackupNow()
                    } label: {
                        Label("Back up now", systemImage: "externaldrive.badge.plus")
                    }
                    .disabled(vm.backupInProgress)
                    Button {
                        vm.openBackupFolder()
                    } label: {
                        Label("Open in Finder", systemImage: "folder")
                    }
                }
                if vm.backupInProgress {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("Backing up...")
                            .font(.caption)
                    }
                }
                if let backupStatus = vm.backupStatus {
                    Text(backupStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding(16)
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .enable:
                PassphrasePromptSheet(
                    mode: .enable,
                    onSubmit: { newPass, _ in
                        rekey(oldPass: "", newPass: newPass, enabled: true)
                    },
                    onCancel: { self.sheet = nil }
                )
            case .disable:
                PassphrasePromptSheet(
                    mode: .disable,
                    onSubmit: { oldPass, _ in
                        rekey(oldPass: oldPass, newPass: "", enabled: false)
                    },
                    onCancel: { self.sheet = nil }
                )
            case .change:
                PassphrasePromptSheet(
                    mode: .change,
                    onSubmit: { oldPass, newPass in
                        rekey(oldPass: oldPass, newPass: newPass, enabled: true)
                    },
                    onCancel: { self.sheet = nil }
                )
            }
        }
    }

    private var encryptionBinding: Binding<Bool> {
        Binding(
            get: { vm.settings.mac.cacheEncryptionEnabled },
            set: { enabled in
                sheet = enabled ? .enable : .disable
            }
        )
    }

    private func rekey(oldPass: String, newPass: String, enabled: Bool) {
        do {
            try RuntimeBridge.rekeyCache(
                cacheRoot: session.cacheRoot,
                oldPass: oldPass,
                newPass: newPass
            )
            vm.updateMac(\.cacheEncryptionEnabled, enabled)
            encryptionStatus = enabled ? "Encryption setting updated." : "Encryption disabled."
            sheet = nil
        } catch {
            encryptionStatus = "\(error)"
            sheet = nil
        }
    }
}
