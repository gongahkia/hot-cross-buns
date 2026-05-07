import SwiftUI

struct AccountsSection: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var vm: SettingsViewModel

    @State private var showSignIn = false
    @State private var showRemoveConfirmation = false
    @State private var accountError: String?

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Google") {
                LabeledContent("Active account") {
                    Text(session.activeAccount ?? "Not signed in")
                        .foregroundStyle(session.activeAccount == nil ? .secondary : .primary)
                }
                LabeledContent("Granted scopes") {
                    Text(grantedScopes)
                        .foregroundStyle(.secondary)
                }
                Button {
                    showSignIn = true
                } label: {
                    Label("Sign in with Google", systemImage: "person.crop.circle.badge.plus")
                }
                .buttonStyle(.borderedProminent)

                Button(role: .destructive) {
                    showRemoveConfirmation = true
                } label: {
                    Label("Remove account", systemImage: "person.crop.circle.badge.xmark")
                }
                .disabled(session.activeAccount == nil)

                if let accountError {
                    Text(accountError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            Section("OAuth client setup") {
                OAuthClientCard()
            }
        }
        .formStyle(.grouped)
        .padding(16)
        .sheet(isPresented: $showSignIn) {
            SignInSheet()
                .environmentObject(session)
        }
        .confirmationDialog(
            "Remove the signed-in account?",
            isPresented: $showRemoveConfirmation
        ) {
            Button("Remove account", role: .destructive) {
                removeAccount()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The refresh token is removed from Keychain. Cached Markdown and settings remain on disk.")
        }
    }

    private var grantedScopes: String {
        guard let account = session.activeAccount else { return "Not signed in" }
        guard let metadata = RuntimeBridge.tokenMetadata(account: account) else {
            return "No token metadata found"
        }
        return metadata.scope
            .split(separator: " ")
            .map(String.init)
            .joined(separator: ", ")
    }

    private func removeAccount() {
        guard let account = session.activeAccount else { return }
        do {
            try RuntimeBridge.clearAccount(account: account)
            var state = OnboardingStateStore.load(cacheRoot: session.cacheRoot)
            state.signedInAccount = nil
            OnboardingStateStore.save(state, cacheRoot: session.cacheRoot)
            session.activeAccount = nil
            accountError = nil
        } catch {
            accountError = "\(error)"
        }
    }
}
