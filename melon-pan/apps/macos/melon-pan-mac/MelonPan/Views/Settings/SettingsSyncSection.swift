import SwiftUI

struct SettingsSyncSection: View {
    @ObservedObject var vm: SettingsViewModel

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Mode") {
                Picker("Sync mode", selection: vm.macBinding(\.syncMode)) {
                    Text("Manual").tag("manual")
                    Text("Balanced").tag("balanced")
                    Text("Near real-time").tag("near-real-time")
                }
                Toggle("Push on save", isOn: vm.binding(\.syncAutoPush))
                Toggle("Pull on focus", isOn: vm.binding(\.syncAutoPull))
            }

            Section("Audit and conflicts") {
                Picker("Audit re-check interval", selection: vm.macBinding(\.auditRecheckSec)) {
                    Text("30 s").tag(30)
                    Text("60 s").tag(60)
                    Text("120 s").tag(120)
                    Text("300 s").tag(300)
                }
                Picker("Conflict copy strategy", selection: vm.macBinding(\.conflictCopyStrategy)) {
                    Text("Suffix ISO timestamp").tag("suffix-iso")
                    Text("Suffix counter").tag("suffix-counter")
                    Text("Ask before overwrite").tag("overwrite-prompt")
                }
            }
        }
        .formStyle(.grouped)
        .padding(16)
    }
}
