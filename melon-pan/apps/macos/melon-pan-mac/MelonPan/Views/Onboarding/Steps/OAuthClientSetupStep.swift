import AppKit
import SwiftUI

struct OAuthClientSetupStep: View {
    @ObservedObject var vm: OnboardingViewModel
    @FocusState private var focusedField: Field?
    @State private var clientID = ""
    @State private var clientSecret = ""
    @State private var didSave = false
    private let setupSteps = [
        "Create a Google Cloud project.",
        "Enable the Google Docs API and Google Drive API.",
        "Configure the OAuth consent screen as External and add yourself as a test user.",
        "In Clients, create an OAuth client with application type Desktop app.",
        "Paste the Desktop app client ID below. If Google shows a client secret, paste it too.",
        "Save the OAuth client, then continue to sign in.",
        "Publish to In production after setup to avoid seven-day refresh-token expiry.",
    ]

    private enum Field {
        case clientID, clientSecret
    }

    var body: some View {
        OnboardingStepCard(title: "Google Cloud OAuth client", systemImage: "key.fill") {
            Text("Create a Desktop OAuth client in your own Google Cloud project. Melon Pan stores the client secret in Keychain and never writes it to onboarding.json.")
                .foregroundStyle(.secondary)

            DisclosureGroup("Setup checklist") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(setupSteps.enumerated()), id: \.offset) { index, step in
                        setupStep(number: index + 1, text: step)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
                .accessibilityElement(children: .combine)
            }

            Button {
                RuntimeBridge.openURL("https://console.cloud.google.com/apis/credentials")
            } label: {
                Label("Open Google Cloud Console", systemImage: "safari")
            }

            fieldRow(
                title: "Desktop OAuth client ID",
                text: $clientID,
                field: .clientID,
                secure: false
            )
            fieldRow(
                title: "Client secret (optional)",
                text: $clientSecret,
                field: .clientSecret,
                secure: true
            )

            if !clientID.isEmpty && !isWellFormedDesktopClientId(trimmedClientID) {
                Text("Use a Desktop OAuth client ID like 1234567890-abc.apps.googleusercontent.com.")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if let error = vm.stepError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if didSave {
                Label("Saved to Keychain.", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
            }

            Button {
                save()
            } label: {
                Label("Save OAuth Client", systemImage: "square.and.arrow.down")
            }
            .buttonStyle(.borderedProminent)
            .disabled(!isWellFormedDesktopClientId(trimmedClientID))
        }
        .onAppear {
            clientID = vm.state.oauthClient?.clientId ?? ""
            focusedField = .clientID
        }
    }

    private var trimmedClientID: String {
        clientID.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func fieldRow(
        title: String,
        text: Binding<String>,
        field: Field,
        secure: Bool
    ) -> some View {
        HStack {
            Group {
                if secure {
                    SecureField(title, text: text)
                } else {
                    TextField(title, text: text)
                }
            }
            .textFieldStyle(.roundedBorder)
            .textContentType(secure ? .password : .username)
            .autocorrectionDisabled()
            .focused($focusedField, equals: field)
            .accessibilityLabel(title)
            .accessibilityHint("Pasted from Google Cloud Console, Credentials, Desktop client.")

            Button("Paste") {
                text.wrappedValue = NSPasteboard.general.string(forType: .string) ?? ""
            }
            .buttonStyle(.bordered)
        }
    }

    private func setupStep(number: Int, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(number).")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 20, alignment: .trailing)
            Text(text)
                .foregroundStyle(.secondary)
        }
        .font(.caption)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func save() {
        vm.stepError = nil
        let trimmed = trimmedClientID
        guard isWellFormedDesktopClientId(trimmed) else {
            vm.stepError = "That client ID does not look like a Desktop OAuth client ID."
            return
        }
        do {
            try RuntimeBridge.saveOAuthClientConfig(
                clientId: trimmed,
                clientSecret: clientSecret
            )
            vm.update { state in
                state.oauthClient = .init(
                    clientId: trimmed,
                    hasSecret: !clientSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }
            didSave = true
        } catch {
            vm.stepError = "\(error)"
        }
    }
}

func isWellFormedDesktopClientId(_ value: String) -> Bool {
    let pattern = #"^[0-9]+-[A-Za-z0-9_]+\.apps\.googleusercontent\.com$"#
    return value.range(of: pattern, options: .regularExpression) != nil
}
