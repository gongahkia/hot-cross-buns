import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject private var selection: SettingsPaneSelection
    @StateObject private var vm = SettingsViewModel()

    init(selection: SettingsPaneSelection = SettingsPaneSelection()) {
        self.selection = selection
    }

    var body: some View {
        TabView(selection: tabBinding) {
            GeneralSection(vm: vm)
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(SettingsTab.general)
            EditorSection(vm: vm)
                .tabItem { Label("Editor", systemImage: "text.cursor") }
                .tag(SettingsTab.editor)
            WorkspaceSection(vm: vm)
                .tabItem { Label("Workspace", systemImage: "sidebar.left") }
                .tag(SettingsTab.workspace)
            SettingsSyncSection(vm: vm)
                .tabItem { Label("Sync", systemImage: "arrow.triangle.2.circlepath") }
                .tag(SettingsTab.sync)
            AccountsSection(vm: vm)
                .tabItem { Label("Accounts", systemImage: "person.crop.circle") }
                .tag(SettingsTab.accounts)
            KeybindingsSection(vm: vm)
                .tabItem { Label("Keys", systemImage: "keyboard") }
                .tag(SettingsTab.keybindings)
            PrivacySection(vm: vm)
                .tabItem { Label("Privacy", systemImage: "lock.shield") }
                .tag(SettingsTab.privacy)
            UpdatesSection(vm: vm)
                .tabItem { Label("Updates", systemImage: "arrow.down.circle") }
                .tag(SettingsTab.updates)
            HistorySection(vm: vm)
                .tabItem { Label("History", systemImage: "clock") }
                .tag(SettingsTab.history)
            AdvancedSection(vm: vm)
                .tabItem { Label("Advanced", systemImage: "gearshape.2") }
                .tag(SettingsTab.advanced)
        }
        .frame(minWidth: 680, idealWidth: 760, minHeight: 520, idealHeight: 600)
        .onAppear {
            vm.load(cacheRoot: session.cacheRoot)
            session.settings = vm.settings
            session.showMenuBarItem = vm.settings.mac.showMenuBarItem
            consumePendingSection()
        }
        .onChange(of: vm.settings) { newValue in
            session.settings = newValue
            session.showMenuBarItem = newValue.mac.showMenuBarItem
        }
        .onChange(of: session.pendingSettingsSection) { _ in
            consumePendingSection()
        }
    }

    private func consumePendingSection() {
        guard let section = session.pendingSettingsSection else { return }
        selection.pane = MelonPanSettingsPane(section: section)
        session.pendingSettingsSection = nil
    }

    private var tabBinding: Binding<SettingsTab> {
        Binding(
            get: { selection.pane.settingsTab },
            set: { selection.pane = MelonPanSettingsPane(tab: $0) }
        )
    }
}

enum SettingsTab: String, CaseIterable, Identifiable {
    case general, editor, workspace, sync, accounts, keybindings, privacy, updates, history, advanced

    var id: String { rawValue }

    init(section: String?) {
        self = MelonPanSettingsPane(section: section).settingsTab
    }
}

extension MelonPanSettingsPane {
    init(tab: SettingsTab) {
        switch tab {
        case .general: self = .general
        case .editor: self = .editor
        case .workspace: self = .workspace
        case .sync: self = .sync
        case .accounts: self = .accounts
        case .keybindings: self = .keys
        case .privacy: self = .privacy
        case .updates: self = .updates
        case .history: self = .history
        case .advanced: self = .advanced
        }
    }
}

struct SettingsStatusBanner: View {
    @Environment(\.appUIFont) private var appUIFont
    @ObservedObject var vm: SettingsViewModel

    var body: some View {
        Group {
            if vm.isCorruptFallback {
                Label(
                    "settings.json was corrupt - defaults loaded.",
                    systemImage: "exclamationmark.triangle"
                )
                .foregroundStyle(.orange)
            } else if let loadError = vm.loadError {
                Label(loadError, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            } else if let saveError = vm.saveError {
                Label(saveError, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }
        }
        .font(.melonPanUI(appUIFont, relativeSize: -2))
    }
}

extension SettingsViewModel {
    func binding<V>(_ keyPath: WritableKeyPath<AppSettings, V>) -> Binding<V> {
        Binding(
            get: { self.settings[keyPath: keyPath] },
            set: { self.update(keyPath, $0) }
        )
    }

    func macBinding<V>(_ keyPath: WritableKeyPath<AppSettings.MacExtras, V>) -> Binding<V> {
        Binding(
            get: { self.settings.mac[keyPath: keyPath] },
            set: { self.updateMac(keyPath, $0) }
        )
    }
}
