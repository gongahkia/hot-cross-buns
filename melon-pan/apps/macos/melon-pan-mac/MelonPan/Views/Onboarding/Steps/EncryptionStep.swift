import SwiftUI

struct EncryptionStep: View {
    @ObservedObject var vm: OnboardingViewModel
    @FocusState private var focusedField: Field?
    @State private var wantsEncryption = false
    @State private var passphrase = ""
    @State private var confirmation = ""

    private enum Field {
        case passphrase, confirmation
    }

    private var canRecordChoice: Bool {
        !wantsEncryption || (passphrase.count >= 12 && passphrase == confirmation)
    }

    var body: some View {
        OnboardingStepCard(title: "Cache encryption", systemImage: "lock.fill") {
            Text("AES-GCM 256 cache encryption is not wired into the macOS runtime yet. If you opt in now, Melon Pan records that choice as deferred and asks again when the feature ships.")
                .foregroundStyle(.secondary)

            Toggle("I want encrypted local cache files when available.", isOn: $wantsEncryption)

            if wantsEncryption {
                SecureField("Passphrase", text: $passphrase)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .passphrase)
                SecureField("Confirm passphrase", text: $confirmation)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .confirmation)
                Text("There is no recovery path for a forgotten cache passphrase. A forgotten passphrase means wiping and rebuilding the local cache.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !passphrase.isEmpty && passphrase.count < 12 {
                    Text("Use at least 12 characters.")
                        .font(.caption)
                        .foregroundStyle(.red)
                } else if !confirmation.isEmpty && passphrase != confirmation {
                    Text("Passphrases do not match.")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            Button("Save Choice") {
                vm.update { state in
                    state.encryption = wantsEncryption ? .deferred : .skipped
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canRecordChoice)
        }
        .onAppear {
            wantsEncryption = vm.state.encryption == .deferred || vm.state.encryption == .enabled
            focusedField = wantsEncryption ? .passphrase : nil
            validate()
        }
        .onChange(of: wantsEncryption) { _ in
            validate()
        }
        .onChange(of: passphrase) { _ in
            validate()
        }
        .onChange(of: confirmation) { _ in
            validate()
        }
    }

    private func validate() {
        guard wantsEncryption else {
            vm.stepError = nil
            return
        }
        if passphrase.count < 12 {
            vm.stepError = "Use at least 12 characters."
        } else if passphrase != confirmation {
            vm.stepError = "Passphrases do not match."
        } else {
            vm.stepError = nil
        }
    }
}
