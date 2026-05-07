import AppKit
import SwiftUI

struct EditorSection: View {
    @ObservedObject var vm: SettingsViewModel

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Editing") {
                Toggle("Vim mode by default", isOn: vm.macBinding(\.vimModeDefault))
                Picker("Theme", selection: vm.binding(\.colorScheme)) {
                    ForEach(AppThemePresetRegistry.presets) { preset in
                        Text(preset.displayName).tag(preset.id)
                    }
                }
                Stepper(value: vm.macBinding(\.editorFontSize), in: 10...24) {
                    LabeledContent("Font size", value: "\(vm.settings.mac.editorFontSize)pt")
                }
                Stepper(value: vm.macBinding(\.editorTabWidth), in: 1...8) {
                    LabeledContent("Tab width", value: "\(vm.settings.mac.editorTabWidth)")
                }
                Toggle("Soft wrap", isOn: vm.macBinding(\.editorSoftWrap))
                Toggle("Show diff gutter", isOn: vm.macBinding(\.editorShowDiffGutter))
                Toggle("Autosave after edits", isOn: vm.macBinding(\.editorAutosaveEnabled))
                Picker("Autosave debounce", selection: vm.macBinding(\.editorAutosaveMs)) {
                    Text("250 ms").tag(250)
                    Text("500 ms").tag(500)
                    Text("1 s").tag(1000)
                    Text("2 s").tag(2000)
                }
                .disabled(!vm.settings.mac.editorAutosaveEnabled)
            }

            Section("Interface") {
                Picker("UI font", selection: uiFontFamilyBinding) {
                    Text("System").tag(AppUIFontResolver.systemFamily)
                    if shouldShowMissingFont {
                        Text("\(vm.settings.mac.uiFontFamily) (Missing)")
                            .tag(vm.settings.mac.uiFontFamily)
                    }
                    ForEach(AppUIFontResolver.availableFontFamilies, id: \.self) { family in
                        Text(family).tag(family)
                    }
                }
                Stepper(value: uiFontSizeBinding, in: AppUIFontResolver.minSize...AppUIFontResolver.maxSize) {
                    LabeledContent("UI font size", value: "\(vm.settings.mac.uiFontSize)pt")
                }
                HStack(spacing: 10) {
                    Image(systemName: "sidebar.left")
                        .foregroundStyle(.secondary)
                    Text("Preview label")
                        .font(.melonPanUI(resolvedUIFont, weight: .medium))
                    Text("⌘P")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(resolvedUIFont.displayName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if shouldShowMissingFont {
                    Text("The saved font is not installed. Melon Pan will use System until it becomes available again.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Appearance") {
                TextField("Background", text: vm.binding(\.customBackground))
                TextField("Sidebar", text: vm.binding(\.customSidebar))
                TextField("Accent", text: vm.binding(\.customAccent))
            }
        }
        .formStyle(.grouped)
        .padding(16)
    }

    private var resolvedUIFont: AppUIFont {
        AppUIFontResolver.resolvedFont(settings: vm.settings)
    }

    private var shouldShowMissingFont: Bool {
        let family = vm.settings.mac.uiFontFamily.trimmingCharacters(in: .whitespacesAndNewlines)
        return !family.isEmpty && !AppUIFontResolver.availableFontFamilies.contains(family)
    }

    private var uiFontFamilyBinding: Binding<String> {
        Binding(
            get: { vm.settings.mac.uiFontFamily },
            set: { vm.updateMac(\.uiFontFamily, $0) }
        )
    }

    private var uiFontSizeBinding: Binding<Int> {
        Binding(
            get: { vm.settings.mac.uiFontSize },
            set: { vm.updateMac(\.uiFontSize, AppUIFontResolver.clampedSize($0)) }
        )
    }
}

struct WorkspaceSection: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.appUIFont) private var appUIFont
    @ObservedObject var vm: SettingsViewModel
    @State private var tree = DriveTree.empty

    var body: some View {
        Form {
            SettingsStatusBanner(vm: vm)

            Section("Workspace Sidebar") {
                Text("Limit the Drive tree shown in the left sidebar to selected folders and files. This keeps large Drives cheaper to render and search.")
                    .font(.melonPanUI(appUIFont))
                    .foregroundStyle(.secondary)

                WorkspaceDriveVisibilityPicker(
                    tree: tree,
                    visibilityMode: workspaceVisibilityModeBinding,
                    selectedDriveIds: workspaceVisibleDriveIdsBinding,
                    refreshing: session.driveRefreshing,
                    canRefresh: session.activeAccount != nil,
                    refreshAction: { session.refreshDriveTree() }
                )
                .frame(minHeight: 320)
            }
        }
        .formStyle(.grouped)
        .padding(16)
        .onAppear {
            reload()
        }
        .onChange(of: session.driveTreeReloadToken) { _ in
            reload()
        }
        .onChange(of: session.cacheRoot) { _ in
            reload()
        }
    }

    private var workspaceVisibilityModeBinding: Binding<String> {
        Binding(
            get: { vm.settings.mac.workspaceVisibilityMode },
            set: { mode in
                vm.updateMac(\.workspaceVisibilityMode, mode)
                if mode == "all" {
                    vm.updateMac(\.workspaceVisibleDriveIds, [])
                }
            }
        )
    }

    private var workspaceVisibleDriveIdsBinding: Binding<[String]> {
        Binding(
            get: { vm.settings.mac.workspaceVisibleDriveIds },
            set: { ids in
                vm.updateMac(\.workspaceVisibleDriveIds, ids)
                if !ids.isEmpty, vm.settings.mac.workspaceVisibilityMode != "selected" {
                    vm.updateMac(\.workspaceVisibilityMode, "selected")
                }
            }
        )
    }

    private func reload() {
        tree = DriveTree.load(from: session.cacheRoot)
    }
}
