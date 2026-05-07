import SwiftUI

struct SignInStep: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var vm: OnboardingViewModel
    @StateObject private var controller = SignInController()

    var body: some View {
        OnboardingStepCard(title: "Sign in with Google", systemImage: "person.crop.circle.badge.plus") {
            Text("Melon Pan opens your browser, completes a loopback OAuth flow, and stores the refresh token in your macOS Keychain.")
                .foregroundStyle(.secondary)

            switch controller.phase {
            case .idle:
                if let account = vm.state.signedInAccount {
                    Label("Signed in as \(account)", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Text("Ready to start. Click Sign In to open your browser.")
                        .foregroundStyle(.secondary)
                }
            case .running:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting on browser callback...")
                }
            case .success(let account):
                Label("Signed in as \(account)", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            if let error = controller.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Button {
                controller.run(session: session) { outcome in
                    vm.update { state in
                        state.signedInAccount = outcome.account
                    }
                }
            } label: {
                Label("Sign In", systemImage: "person.crop.circle.badge.plus")
            }
            .buttonStyle(.borderedProminent)
            .disabled(controller.phase == .running)
        }
    }
}
