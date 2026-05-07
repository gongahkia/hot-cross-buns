import SwiftUI

struct DoneStep: View {
    @ObservedObject var vm: OnboardingViewModel

    var body: some View {
        OnboardingStepCard(title: "Ready to open Melon Pan", systemImage: "checkmark.circle.fill") {
            Text("Setup is complete. Melon Pan is ready to pull Google Docs into the local rich-doc cache.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                summary("OAuth client", vm.state.oauthClient?.clientId ?? "Not saved")
                summary("Signed-in account", vm.state.signedInAccount ?? "Not signed in")
                summary("Cache root", vm.effectiveCacheRoot)
                summary("Encryption", vm.state.encryption.rawValue)
                summary("Notifications", vm.state.notifications.rawValue)
                summary("Workspace Drive", workspaceVisibilitySummary)
            }
        }
    }

    private var workspaceVisibilitySummary: String {
        if vm.state.workspaceVisibilityMode == "selected" {
            return "\(vm.state.workspaceVisibleDriveIds.count) selected"
        }
        return "All cached items"
    }

    private func summary(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
                .frame(width: 140, alignment: .leading)
            Text(value)
                .textSelection(.enabled)
                .lineLimit(2)
        }
        .font(.callout)
    }
}
