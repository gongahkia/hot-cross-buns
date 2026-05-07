import SwiftUI

struct KeychainSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Keychain", systemImage: "key") {
            switch viewModel.keychain {
            case .loading:
                ProgressView().controlSize(.small)
            case .ok(let itemCount, let service):
                InfoRow(title: "Status", value: "ok")
                InfoRow(title: "Service", value: service, monospacedValue: true)
                InfoRow(title: "Items", value: "\(itemCount)")
            case .locked:
                InfoRow(title: "Status", value: "locked")
                Text("Unlock login keychain in Keychain Access, then refresh.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case .denied:
                InfoRow(title: "Status", value: "denied")
                Button {
                    RuntimeBridge.openURL("file:///System/Applications/Utilities/Keychain%20Access.app")
                } label: {
                    Label("Open Keychain Access", systemImage: "key")
                }
            case .missing:
                InfoRow(title: "Status", value: "not found")
            case .error(let detail):
                InfoRow(title: "Error", value: detail)
            }
        }
    }
}
