import SwiftUI

struct GoogleOAuthClientSetupView: View {
    @Environment(AppModel.self) private var model
    @State private var clientID: String = ""
    @State private var clientSecret: String = ""
    @State private var didLoad = false
    @State private var didSave = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Google Cloud OAuth client", systemImage: model.customOAuthClientConfiguration == nil ? "key.fill" : "checkmark.shield.fill")
                    .hcbFont(.headline)
                    .foregroundStyle(model.customOAuthClientConfiguration == nil ? AppColor.ink : AppColor.moss)
                Spacer()
                if let configuration = model.customOAuthClientConfiguration {
                    Text(configuration.redactedClientID)
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Text("Use this when you want a downloaded DMG to connect through your own Google Cloud project instead of a client embedded by the maintainer.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            DisclosureGroup("Setup checklist") {
                VStack(alignment: .leading, spacing: 8) {
                    setupStep("Create a Google Cloud project.")
                    setupStep("Enable the Google Tasks API and Google Calendar API.")
                    setupStep("Configure the Google Auth platform. For personal Gmail use, choose External and add yourself while testing.")
                    setupStep("Create a Desktop app OAuth client.")
                    setupStep("Paste the desktop client ID below. If Google shows a client secret, paste it too.")
                    setupStep("For daily use without weekly re-consent, publish the OAuth app to In production.")
                }
                .hcbScaledPadding(.top, 8)
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
                    model.saveCustomOAuthClientConfiguration(
                        clientID: clientID,
                        clientSecret: clientSecret
                    )
                    didSave = model.customOAuthClientConfiguration != nil
                } label: {
                    Label("Save OAuth Client", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .disabled(clientID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if model.customOAuthClientConfiguration != nil {
                    Button(role: .destructive) {
                        model.clearCustomOAuthClientConfiguration()
                        clientID = ""
                        clientSecret = ""
                        didSave = false
                    } label: {
                        Label("Clear", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                }
            }

            if didSave {
                Label("Saved. Use Connect Google to finish OAuth in your browser.", systemImage: "checkmark.circle.fill")
                    .hcbFont(.caption)
                    .foregroundStyle(AppColor.moss)
            }

            Text("The app stores this OAuth client and the resulting refresh token in your macOS Keychain. Clearing the client removes the saved custom client and token from this Mac.")
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .onAppear(perform: loadExistingConfiguration)
    }

    private func setupStep(_ text: String) -> some View {
        Label {
            Text(text)
                .foregroundStyle(.secondary)
        } icon: {
            Image(systemName: "circle.fill")
                .font(.system(size: 5))
                .foregroundStyle(.secondary)
        }
        .hcbFont(.caption)
    }

    private func loadExistingConfiguration() {
        guard didLoad == false else { return }
        didLoad = true
        if let configuration = model.customOAuthClientConfiguration {
            clientID = configuration.clientID
            clientSecret = configuration.clientSecret ?? ""
        }
    }
}
