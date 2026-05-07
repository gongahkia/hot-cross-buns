import AppKit
import SwiftUI

struct AdvancedSection: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: AppSession
    @AppStorage("melonpan.drive.showKind.googleDoc") private var showGoogleDocs = true
    @AppStorage("melonpan.drive.showKind.googleSheet") private var showGoogleSheets = false
    @AppStorage("melonpan.drive.showKind.googleSlide") private var showGoogleSlides = false
    @AppStorage("melonpan.drive.showKind.pdf") private var showPDFs = false
    @AppStorage("melonpan.drive.showKind.image") private var showImages = false
    @AppStorage("melonpan.drive.showKind.video") private var showVideos = false
    @AppStorage("melonpan.drive.showKind.audio") private var showAudio = false
    @AppStorage("melonpan.drive.showKind.text") private var showTextFiles = false
    @AppStorage("melonpan.drive.showKind.other") private var showOtherFiles = false
    @ObservedObject var vm: SettingsViewModel

    @State private var showResetSettingsConfirmation = false
    @State private var showResetOnboardingConfirmation = false

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Cache") {
                Button {
                    NSWorkspace.shared.activateFileViewerSelecting([
                        URL(fileURLWithPath: session.cacheRoot)
                    ])
                } label: {
                    Label("Open cache in Finder", systemImage: "folder")
                }

                Button(role: .destructive) {
                    showResetSettingsConfirmation = true
                } label: {
                    Label("Reset settings", systemImage: "trash")
                }
            }

            Section("Diagnostics") {
                Button {
                    session.openUtilityWindow(.diagnostics)
                    dismiss()
                } label: {
                    Label("Show diagnostics", systemImage: "stethoscope")
                }
                Toggle("Auto-collapse sidebar while typing", isOn: vm.binding(\.autoCollapseSidebar))
            }

            Section("Drive") {
                Text("Choose exactly which Drive file kinds appear in the main sidebar. Folders with no visible descendants are hidden.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Toggle(DriveFileKind.googleDoc.label, isOn: $showGoogleDocs)
                Toggle(DriveFileKind.googleSheet.label, isOn: $showGoogleSheets)
                Toggle(DriveFileKind.googleSlide.label, isOn: $showGoogleSlides)
                Toggle(DriveFileKind.pdf.label, isOn: $showPDFs)
                Toggle(DriveFileKind.image.label, isOn: $showImages)
                Toggle(DriveFileKind.video.label, isOn: $showVideos)
                Toggle(DriveFileKind.audio.label, isOn: $showAudio)
                Toggle(DriveFileKind.text.label, isOn: $showTextFiles)
                Toggle(DriveFileKind.other.label, isOn: $showOtherFiles)

                HStack {
                    Button("Editable only") {
                        setEditableOnlyDriveVisibility()
                    }
                    Button("Show all") {
                        setAllDriveKindsVisible()
                    }
                }
            }

            Section("Onboarding") {
                Button(role: .destructive) {
                    showResetOnboardingConfirmation = true
                } label: {
                    Label("Reset onboarding...", systemImage: "arrow.counterclockwise")
                }
            }
        }
        .formStyle(.grouped)
        .padding(16)
        .confirmationDialog(
            "Reset settings?",
            isPresented: $showResetSettingsConfirmation
        ) {
            Button("Reset settings", role: .destructive) {
                vm.resetSettingsFile()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Only settings.json is deleted. Cached documents, account tokens, onboarding, and window state remain.")
        }
        .confirmationDialog(
            "Reset onboarding?",
            isPresented: $showResetOnboardingConfirmation
        ) {
            Button("Reset onboarding", role: .destructive) {
                session.resetOnboarding()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Progress is cleared and the setup wizard appears over the main window. Google tokens stay in Keychain.")
        }
    }

    private func setEditableOnlyDriveVisibility() {
        showGoogleDocs = true
        showGoogleSheets = false
        showGoogleSlides = false
        showPDFs = false
        showImages = false
        showVideos = false
        showAudio = false
        showTextFiles = false
        showOtherFiles = false
    }

    private func setAllDriveKindsVisible() {
        showGoogleDocs = true
        showGoogleSheets = true
        showGoogleSlides = true
        showPDFs = true
        showImages = true
        showVideos = true
        showAudio = true
        showTextFiles = true
        showOtherFiles = true
    }
}
