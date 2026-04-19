import SwiftUI

struct UpdatesSection: View {
    @Environment(UpdaterController.self) private var updater
    @State private var autoCheck: Bool = true

    var body: some View {
        Section("Updates") {
            if updater.isConfigured {
                Toggle("Check for updates automatically", isOn: autoCheckBinding)
                Button {
                    updater.checkForUpdates()
                } label: {
                    Label("Check for Updates Now", systemImage: "arrow.down.circle")
                }
                if let last = updater.lastUpdateCheckDate {
                    Text("Last checked \(last.formatted(date: .abbreviated, time: .shortened))")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                Label("Updates unavailable until Sparkle keys are configured.", systemImage: "exclamationmark.triangle")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear {
            if updater.isConfigured {
                autoCheck = updater.automaticallyChecksForUpdates
            }
        }
    }

    private var autoCheckBinding: Binding<Bool> {
        Binding(
            get: { autoCheck },
            set: { newValue in
                autoCheck = newValue
                updater.automaticallyChecksForUpdates = newValue
            }
        )
    }
}
