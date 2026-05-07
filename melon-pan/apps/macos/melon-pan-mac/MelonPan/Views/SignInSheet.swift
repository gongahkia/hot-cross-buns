// OAuth sign-in sheet. The Rust runtime drives the actual loopback
// flow: it binds 127.0.0.1, builds the auth URL, opens the user's
// browser via /usr/bin/open, blocks on the callback, exchanges the
// code, persists the token in the Keychain, and returns the resolved
// account name. The Swift side just shows progress + surfaces errors.

import SwiftUI

struct SignInSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss

    @StateObject private var controller = SignInController()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign in with Google")
                .font(.title2)
            Text("Melon Pan opens your browser, completes a loopback OAuth flow, and stores the refresh token in your macOS Keychain. Closing this sheet cancels the pending sign-in.")
                .foregroundStyle(.secondary)

            switch controller.phase {
            case .idle:
                Text("Ready to start. Click Sign In to open your browser.")
                    .foregroundStyle(.secondary)
            case .running:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting on browser callback…")
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

            HStack {
                Spacer()
                switch controller.phase {
                case .success:
                    Button("Done") {
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                case .idle, .running:
                    Button("Cancel") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Button("Sign In") {
                        controller.run(session: session)
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return)
                    .disabled(controller.phase != .idle)
                }
            }
        }
        .padding(24)
        .frame(width: 500)
    }
}

@MainActor
final class SignInController: ObservableObject {
    enum Phase: Equatable {
        case idle, running, success(String)
    }

    @Published var phase: Phase = .idle
    @Published var error: String?

    func run(
        session: AppSession,
        onSuccess: ((RuntimeBridge.LoginOutcome) -> Void)? = nil
    ) {
        phase = .running
        error = nil
        let credentials = session.credentialsPath
        Task.detached(priority: .userInitiated) {
            do {
                let outcome: RuntimeBridge.LoginOutcome
                do {
                    outcome = try RuntimeBridge.runLoginWithSavedOAuthClient(
                        accountOverride: nil,
                        narrowScope: false,
                        port: 0
                    )
                } catch {
                    guard "\(error)".contains("load_oauth_client_config") else {
                        throw error
                    }
                    outcome = try RuntimeBridge.runLogin(
                        credentialsPath: credentials,
                        accountOverride: nil,
                        narrowScope: false,
                        port: 0
                    )
                }
                await MainActor.run {
                    session.setActiveAccount(outcome.account)
                    self.phase = .success(outcome.account)
                    onSuccess?(outcome)
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "sign-in",
                        kind: .success,
                        title: "Signed in",
                        detail: outcome.email,
                        autoDismissAfter: 4,
                        canDismiss: true
                    ))
                }
            } catch {
                await MainActor.run {
                    self.phase = .idle
                    self.error = "\(error)"
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "sign-in",
                        kind: .error,
                        title: "Sign in failed",
                        detail: "\(error)",
                        primaryAction: BannerAction(label: "Retry") {
                            AppStatusCenter.shared.requestSignIn?()
                        },
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
        }
    }
}
