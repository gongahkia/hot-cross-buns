import SwiftUI

struct PassphrasePromptSheet: View {
    enum Mode {
        case enable, disable, change
    }

    let mode: Mode
    let onSubmit: (String, String) -> Void
    let onCancel: () -> Void

    @State private var first = ""
    @State private var second = ""
    @State private var confirm = ""

    var body: some View {
        NavigationStack {
            Form {
                switch mode {
                case .enable:
                    Section("New passphrase") {
                        SecureField("Passphrase", text: $first)
                        SecureField("Confirm", text: $confirm)
                    }
                case .disable:
                    Section("Current passphrase") {
                        SecureField("Passphrase", text: $first)
                        Text("Disabling rewrites the cache as plaintext when encryption support is available.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                case .change:
                    Section("Current passphrase") {
                        SecureField("Current", text: $first)
                    }
                    Section("New passphrase") {
                        SecureField("New", text: $second)
                        SecureField("Confirm new", text: $confirm)
                    }
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        onSubmit(first, mode == .change ? second : "")
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSubmit)
                }
            }
        }
        .frame(minWidth: 380, minHeight: 240)
    }

    private var title: String {
        switch mode {
        case .enable:
            return "Enable encryption"
        case .disable:
            return "Disable encryption"
        case .change:
            return "Change passphrase"
        }
    }

    private var canSubmit: Bool {
        switch mode {
        case .enable:
            return !first.isEmpty && first == confirm
        case .disable:
            return !first.isEmpty
        case .change:
            return !first.isEmpty && !second.isEmpty && second == confirm
        }
    }
}
