import SwiftUI

struct DriveFolderStep: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var vm: OnboardingViewModel
    @State private var tree = DriveTree.empty
    @State private var refreshing = false
    @State private var workspaceVisibilityMode = "all"
    @State private var selectedDriveIds: [String] = []

    var body: some View {
        OnboardingStepCard(title: "Workspace Drive visibility", systemImage: "sidebar.left") {
            Text("Choose which cached Drive folders and files should appear in the workspace sidebar. Keeping this focused reduces sidebar work on large Drives.")
                .foregroundStyle(.secondary)

            WorkspaceDriveVisibilityPicker(
                tree: tree,
                visibilityMode: $workspaceVisibilityMode,
                selectedDriveIds: $selectedDriveIds,
                refreshing: refreshing,
                canRefresh: session.activeAccount != nil,
                refreshAction: refresh
            )
            .frame(minHeight: 260)

            if let error = vm.stepError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Button("Save Workspace Visibility") {
                vm.stepError = nil
                saveWorkspaceVisibility()
            }
            .buttonStyle(.borderedProminent)
            .disabled(workspaceVisibilityMode == "selected" && selectedDriveIds.isEmpty)
        }
        .onAppear {
            reload()
        }
    }

    private func reload() {
        tree = DriveTree.load(from: vm.effectiveCacheRoot)
        let settings = (try? RuntimeBridge.loadSettings(cacheRoot: vm.effectiveCacheRoot)) ?? session.settings
        workspaceVisibilityMode = settings.mac.workspaceVisibilityMode
        selectedDriveIds = settings.mac.workspaceVisibleDriveIds
        if workspaceVisibilityMode == "all",
           selectedDriveIds.isEmpty,
           let legacyFolderId = vm.state.defaultDriveFolderId {
            workspaceVisibilityMode = "selected"
            selectedDriveIds = [legacyFolderId]
        }
    }

    private func refresh() {
        guard let account = session.activeAccount else { return }
        refreshing = true
        vm.stepError = nil
        let credentials = session.credentialsPath
        let cacheRoot = vm.effectiveCacheRoot
        Task.detached(priority: .userInitiated) {
            do {
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                _ = try RuntimeBridge.refreshDriveTree(
                    accessToken: token,
                    parentId: nil,
                    cacheRoot: cacheRoot
                )
                await MainActor.run {
                    refreshing = false
                    reload()
                }
            } catch {
                await MainActor.run {
                    refreshing = false
                    vm.stepError = "\(error)"
                }
            }
        }
    }

    private func saveWorkspaceVisibility() {
        var settings = (try? RuntimeBridge.loadSettings(cacheRoot: vm.effectiveCacheRoot)) ?? session.settings
        settings.mac.workspaceVisibilityMode = workspaceVisibilityMode
        settings.mac.workspaceVisibleDriveIds = workspaceVisibilityMode == "selected"
            ? selectedDriveIds
            : []
        do {
            try RuntimeBridge.saveSettings(cacheRoot: vm.effectiveCacheRoot, settings: settings)
            session.settings = settings
            vm.update { state in
                state.workspaceVisibilityMode = settings.mac.workspaceVisibilityMode
                state.workspaceVisibleDriveIds = settings.mac.workspaceVisibleDriveIds
                state.defaultDriveFolderId = settings.mac.workspaceVisibilityMode == "selected"
                    ? selectedFolderIdForLegacySummary
                    : nil
            }
        } catch {
            vm.stepError = "\(error)"
        }
    }

    private var selectedFolderIdForLegacySummary: String? {
        let selected = Set(selectedDriveIds)
        return tree.files.first { $0.isFolder && selected.contains($0.id) }?.id
    }
}

struct WorkspaceDriveVisibilityPicker: View {
    @Environment(\.appTheme) private var theme
    let tree: DriveTree
    @Binding var visibilityMode: String
    @Binding var selectedDriveIds: [String]
    let refreshing: Bool
    let canRefresh: Bool
    let refreshAction: () -> Void
    @State private var searchText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Sidebar content", selection: $visibilityMode) {
                Text("All cached Drive items").tag("all")
                Text("Only selected folders and files").tag("selected")
            }
            .pickerStyle(.segmented)

            HStack(spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(theme.secondaryForeground)
                    TextField("Filter cached Drive items", text: $searchText)
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(theme.surface.opacity(0.86), in: RoundedRectangle(cornerRadius: 6, style: .continuous))

                Button {
                    refreshAction()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(refreshing || !canRefresh)

                if refreshing {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if tree.files.isEmpty {
                Text(canRefresh ? "No cached Drive tree yet. Refresh Drive first." : "Sign in first, or choose later.")
                    .foregroundStyle(theme.secondaryForeground)
            } else if visibilityMode == "all" {
                allItemsSummary
            } else {
                selectedItemsList
            }
        }
    }

    private var allItemsSummary: some View {
        HStack(spacing: 8) {
            Label("\(folderCount)", systemImage: "folder")
            Label("\(fileCount)", systemImage: "doc.text")
            Spacer()
            Button("Clear Selection") {
                selectedDriveIds = []
            }
            .disabled(selectedDriveIds.isEmpty)
        }
        .font(.callout)
        .foregroundStyle(theme.secondaryForeground)
        .padding(10)
        .background(theme.surface.opacity(0.55), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var selectedItemsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(selectedDriveIds.count) selected")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryForeground)
                Spacer()
                Button("Clear") {
                    selectedDriveIds = []
                }
                .disabled(selectedDriveIds.isEmpty)
            }

            List {
                OutlineGroup(filteredNodes, children: \.children) { node in
                    driveSelectionRow(node)
                }
            }
            .listStyle(.sidebar)
            .frame(minHeight: 220)
        }
    }

    private func driveSelectionRow(_ node: DriveNode) -> some View {
        Toggle(isOn: selectedBinding(for: node.item.id)) {
            HStack(spacing: 8) {
                Image(systemName: node.item.systemImage)
                    .foregroundStyle(node.item.isFolder ? theme.secondaryForeground : theme.foreground)
                    .frame(width: 16)
                Text(node.item.name)
                    .lineLimit(1)
                Spacer()
                if node.item.isFolder {
                    Text("folder")
                        .font(.caption2)
                        .foregroundStyle(theme.secondaryForeground)
                } else if !node.item.isDocument {
                    Text(node.item.fileKind.label)
                        .font(.caption2)
                        .foregroundStyle(theme.secondaryForeground)
                }
            }
        }
        .toggleStyle(.checkbox)
        .help(node.item.isFolder ? "Selected folders include their descendants in the workspace sidebar." : "Selected files are shown with their parent folders.")
    }

    private var filteredNodes: [DriveNode] {
        let roots = DriveTreeIndex.build(from: DriveTree(files: tree.files.filter { !$0.trashed }))
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return roots }
        return roots.compactMap { filterNode($0, query: query, ancestorMatches: false) }
    }

    private func filterNode(_ node: DriveNode, query: String, ancestorMatches: Bool) -> DriveNode? {
        let matches = node.item.name.localizedCaseInsensitiveContains(query)
        let childMatches = node.children?.compactMap {
            filterNode($0, query: query, ancestorMatches: ancestorMatches || matches)
        }
        if matches || ancestorMatches || childMatches?.isEmpty == false {
            return DriveNode(id: node.id, item: node.item, children: node.item.isFolder ? (childMatches ?? []) : nil)
        }
        return nil
    }

    private func selectedBinding(for id: String) -> Binding<Bool> {
        Binding(
            get: { Set(selectedDriveIds).contains(id) },
            set: { isSelected in
                var ids = Set(selectedDriveIds)
                if isSelected {
                    ids.insert(id)
                } else {
                    ids.remove(id)
                }
                selectedDriveIds = ids.sorted()
            }
        )
    }

    private var folderCount: Int {
        tree.files.filter { $0.isFolder && !$0.trashed }.count
    }

    private var fileCount: Int {
        tree.files.filter { !$0.isFolder && !$0.trashed }.count
    }
}
