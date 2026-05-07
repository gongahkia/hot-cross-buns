import SwiftUI

struct ScopeStep: View {
    @ObservedObject var vm: OnboardingViewModel

    var body: some View {
        OnboardingStepCard(title: "Google scopes", systemImage: "lock.shield") {
            Text("Melon Pan asks for the access it needs for Docs editing, Drive browsing, and comment display.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                scope("https://www.googleapis.com/auth/drive.file", "Files you create or explicitly open with Melon Pan.")
                scope("https://www.googleapis.com/auth/drive.readonly", "Read Drive comments for documents you open.")
                scope("https://www.googleapis.com/auth/drive.metadata.readonly", "List Google Docs and folders in Drive.")
                scope("https://www.googleapis.com/auth/documents", "Read and update Google Docs content.")
            }

            Text("Melon Pan avoids the full Drive read/write scope.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Toggle("Got it.", isOn: acknowledged)
        }
    }

    private var acknowledged: Binding<Bool> {
        Binding(
            get: { vm.state.scopesAcknowledged },
            set: { value in vm.update { $0.scopesAcknowledged = value } }
        )
    }

    private func scope(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(.caption, design: .monospaced))
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
