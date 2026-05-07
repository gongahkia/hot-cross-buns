import AppKit
import SwiftUI

struct CacheRootStep: View {
    @ObservedObject var vm: OnboardingViewModel
    @State private var selectedPath = ""
    @State private var isSaving = false

    var body: some View {
        OnboardingStepCard(title: "Local cache folder", systemImage: "externaldrive") {
            Text("Melon Pan keeps Docs JSON, snapshots, and the Drive tree in a local cache.")
                .foregroundStyle(.secondary)

            InfoRow(
                title: "Cache root",
                value: selectedPath.isEmpty ? vm.effectiveCacheRoot : selectedPath,
                monospacedValue: true
            )

            HStack {
                Button("Choose a different folder...") {
                    chooseFolder()
                }
                Button("Use default") {
                    selectedPath = ""
                    save(path: nil)
                }
                .disabled(vm.state.cacheRootOverride == nil)
            }

            if isSaving {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Initializing cache...")
                        .foregroundStyle(.secondary)
                }
            }
            if let error = vm.stepError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .onAppear {
            selectedPath = vm.state.cacheRootOverride ?? vm.effectiveCacheRoot
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Use Folder"
        if panel.runModal() == .OK, let url = panel.url {
            selectedPath = url.path
            save(path: url.path)
        }
    }

    private func save(path: String?) {
        vm.stepError = nil
        isSaving = true
        let target = path ?? RuntimeBridge.defaultCacheRoot()
        Task.detached(priority: .userInitiated) {
            do {
                try RuntimeBridge.initializeCache(at: target)
                await MainActor.run {
                    vm.setCacheRootOverride(path)
                    isSaving = false
                }
            } catch {
                await MainActor.run {
                    vm.stepError = "\(error)"
                    isSaving = false
                }
            }
        }
    }
}
