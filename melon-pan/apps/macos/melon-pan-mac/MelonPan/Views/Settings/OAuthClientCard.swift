import SwiftUI

struct OAuthClientCard: View {
    @State private var clientID = ""
    @State private var clientSecret = ""
    @State private var existingClientID: String?
    @State private var didLoad = false
    @State private var status: String?
    private let setupSteps = [
        "Create a Google Cloud project.",
        "Enable the Google Docs API and Google Drive API.",
        "Configure the OAuth consent screen as External and add yourself while testing.",
        "Create an OAuth client with application type Desktop app.",
        "Paste the Desktop app client ID below. If Google shows a client secret, paste it too.",
        "Save the OAuth client, then sign in again.",
        "Publish to In production after setup to avoid seven-day refresh-token expiry.",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(
                    "Google Cloud OAuth client",
                    systemImage: existingClientID == nil ? "key.fill" : "checkmark.shield.fill"
                )
                Spacer()
                if let existingClientID {
                    Text(redacted(existingClientID))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Text("Downloaded builds can sync through your own Google Cloud project. The OAuth client and refresh token are stored in your Mac Keychain.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            DisclosureGroup("Setup checklist") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(setupSteps.enumerated()), id: \.offset) { index, step in
                        setupStep(number: index + 1, text: step)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
            }

            TextField("Desktop OAuth client ID", text: $clientID)
                .textFieldStyle(.roundedBorder)
                .textContentType(.username)
                .autocorrectionDisabled()

            SecureField("Client secret (optional)", text: $clientSecret)
                .textFieldStyle(.roundedBorder)
                .textContentType(.password)

            HStack {
                Button {
                    save()
                } label: {
                    Label("Save OAuth Client", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isWellFormedDesktopClientId(trimmedClientID))

                if existingClientID != nil {
                    Button(role: .destructive) {
                        clear()
                    } label: {
                        Label("Clear", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                }
            }

            if !trimmedClientID.isEmpty && !isWellFormedDesktopClientId(trimmedClientID) {
                Text("Use a Desktop OAuth client ID like 1234567890-abc.apps.googleusercontent.com.")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if let status {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear(perform: loadExistingConfiguration)
    }

    private var trimmedClientID: String {
        clientID.trimmingCharacters(in: .whitespacesAndNewlines)
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

    private func loadExistingConfiguration() {
        guard !didLoad else { return }
        didLoad = true
        guard let raw = RuntimeBridge.tokenLookup(account: "oauth-client-config") else { return }
        let parts = raw.components(separatedBy: "\n")
        guard let id = parts.first, !id.isEmpty else { return }
        existingClientID = id
        clientID = id
    }

    private func save() {
        do {
            try RuntimeBridge.saveOAuthClientConfig(
                clientId: trimmedClientID,
                clientSecret: clientSecret
            )
            existingClientID = trimmedClientID
            status = "Saved to Keychain. Sign in again to use this client."
        } catch {
            status = "\(error)"
        }
    }

    private func clear() {
        do {
            try RuntimeBridge.clearAccount(account: "oauth-client-config")
            clientID = ""
            clientSecret = ""
            existingClientID = nil
            status = "Cleared from Keychain."
        } catch {
            status = "\(error)"
        }
    }

    private func redacted(_ value: String) -> String {
        guard value.count > 12 else { return value }
        return "\(value.prefix(6))...\(value.suffix(6))"
    }
}
