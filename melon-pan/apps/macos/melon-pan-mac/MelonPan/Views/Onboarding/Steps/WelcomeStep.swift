import SwiftUI

struct WelcomeStep: View {
    @ObservedObject var vm: OnboardingViewModel

    var body: some View {
        OnboardingStepCard(title: "Welcome to Melon Pan", systemImage: "doc.richtext.fill") {
            Text("Rich Google Docs as the source of truth.")
                .font(.title3)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                promise("Your cache stays local on this Mac.")
                promise("Pulled Docs JSON and snapshots stay recoverable on disk.")
                promise("Google refresh tokens and OAuth client secrets stay in Keychain.")
            }

            Text("Coming from another device? Use Settings > Storage after setup to import an existing cache.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Toggle("I understand how Melon Pan stores and syncs data.", isOn: acknowledged)
        }
    }

    private var acknowledged: Binding<Bool> {
        Binding(
            get: { vm.state.welcomeAcknowledged },
            set: { value in vm.update { $0.welcomeAcknowledged = value } }
        )
    }

    private func promise(_ text: String) -> some View {
        Label(text, systemImage: "checkmark.circle")
            .foregroundStyle(.primary)
    }
}
