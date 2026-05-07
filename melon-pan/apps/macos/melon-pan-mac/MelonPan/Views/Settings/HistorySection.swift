import SwiftUI

struct HistorySection: View {
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var session: AppSession
    @ObservedObject var vm: SettingsViewModel

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("History") {
                Button {
                    session.showHistory(documentId: nil)
                    openWindow(id: "history")
                } label: {
                    Label("Open History...", systemImage: "clock.arrow.circlepath")
                }
                .buttonStyle(.borderedProminent)

                Stepper(value: vm.macBinding(\.historyRetentionDays), in: 7...365) {
                    LabeledContent("Retain history", value: "\(vm.settings.mac.historyRetentionDays) days")
                }
                Toggle("Snapshot history", isOn: vm.binding(\.historySnapshots))
            }
        }
        .formStyle(.grouped)
        .padding(16)
    }
}
