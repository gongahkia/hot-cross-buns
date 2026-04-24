import SwiftUI

struct UpdatesSection: View {
    @Environment(UpdaterController.self) private var updater
    @State private var autoCheck: Bool = true

    var body: some View {
        Section("Updates") {
            Toggle(updater.automaticCheckLabel, isOn: autoCheckBinding)

            Button {
                updater.checkForUpdates()
            } label: {
                Label(
                    updater.isChecking ? "Checking GitHub Releases…" : "Check for Updates Now",
                    systemImage: "arrow.down.circle"
                )
            }
            .disabled(updater.isChecking)

            if let release = updater.availableRelease {
                LabeledContent("Latest available") {
                    Text("Version \(release.version)")
                }
                if let publishedAt = release.publishedAt {
                    Text("Published \(publishedAt.formatted(date: .abbreviated, time: .shortened))")
                        .hcbFont(.footnote)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    Button(release.downloadURL == nil ? "Open Release Notes" : "Download Latest DMG") {
                        updater.openAvailableReleaseDownload()
                    }
                    Button("View Releases Page") {
                        updater.openReleasesPage()
                    }
                }
            } else {
                Label(
                    updater.isConfigured
                        ? "Signed release builds can install updates in-app."
                        : "This checks GitHub Releases and opens the latest DMG. It does not replace the app in place.",
                    systemImage: updater.isConfigured ? "arrow.triangle.2.circlepath" : "shippingbox"
                )
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let last = updater.lastUpdateCheckDate {
                Text("Last checked \(last.formatted(date: .abbreviated, time: .shortened)) via \(updater.updateSourceLabel)")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear {
            autoCheck = updater.automaticallyChecksForUpdates
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
