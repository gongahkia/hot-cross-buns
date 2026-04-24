import SwiftUI

struct UpdatesSection: View {
    @Environment(UpdaterController.self) private var updater
    @Environment(\.openWindow) private var openWindow
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
                    Button("What's New") {
                        updater.presentAvailableReleasePrompt()
                        openWindow(id: "update-available")
                    }
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
                        : "This checks GitHub Releases, prompts when a new DMG exists, and opens the download for a manual replace.",
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

struct UpdateAvailableWindow: View {
    @Environment(UpdaterController.self) private var updater

    var body: some View {
        Group {
            if let release = updater.availableRelease {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(release)
                        actions(release)
                        notes(release)
                        installGuidance
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
                .background(Color.clear)
            } else {
                ContentUnavailableView(
                    "No Update Available",
                    systemImage: "checkmark.circle",
                    description: Text("Hot Cross Buns did not find a newer release yet.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(24)
            }
        }
    }

    @ViewBuilder
    private func header(_ release: UpdaterController.AvailableRelease) -> some View {
        let resolvedTitle: String = {
            let candidate = release.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return candidate.isEmpty ? "Update Available" : candidate
        }()
        VStack(alignment: .leading, spacing: 8) {
            Text(resolvedTitle)
                .font(.title2.weight(.semibold))
            Text("Hot Cross Buns \(release.version) is available from GitHub Releases.")
                .foregroundStyle(.secondary)
            if let publishedAt = release.publishedAt {
                Text("Published \(publishedAt.formatted(date: .abbreviated, time: .shortened))")
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func actions(_ release: UpdaterController.AvailableRelease) -> some View {
        HStack(spacing: 12) {
            Button(release.downloadURL == nil ? "Open Release Page" : "Download Latest DMG") {
                updater.openAvailableReleaseDownload()
            }
            .buttonStyle(.borderedProminent)

            Button("View All Releases") {
                updater.openReleasesPage()
            }
            .buttonStyle(.bordered)
        }
    }

    @ViewBuilder
    private func notes(_ release: UpdaterController.AvailableRelease) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Release Notes")
                .font(.headline)

            if release.notesMarkdown.isEmpty {
                Text("No release notes were published for this version.")
                    .foregroundStyle(.secondary)
            } else {
                MarkdownBlock(source: release.notesMarkdown, lineSpacing: 6)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var installGuidance: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Install Guidance")
                .font(.headline)
            Text("Installing the new DMG replaces the app bundle only. Your settings, local cache, and history stay on this Mac because they live outside the app in UserDefaults and Application Support.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
