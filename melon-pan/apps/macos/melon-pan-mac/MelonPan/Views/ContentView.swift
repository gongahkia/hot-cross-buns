// Top-level document workspace: Drive folders and Docs on the left,
// the active editor on the right. Utility surfaces live in menus and
// secondary windows so the main window stays document-first.

import AppKit
import SwiftUI

struct ContentView: View {
    @Environment(\.openWindow) private var openWindow
    @Environment(\.appTheme) private var theme
    @Environment(\.appUIFont) private var appUIFont
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var statusCenter: AppStatusCenter
    @AppStorage("melonpan.drive.showKind.googleDoc") private var showGoogleDocs = true
    @AppStorage("melonpan.drive.showKind.googleSheet") private var showGoogleSheets = false
    @AppStorage("melonpan.drive.showKind.googleSlide") private var showGoogleSlides = false
    @AppStorage("melonpan.drive.showKind.pdf") private var showPDFs = false
    @AppStorage("melonpan.drive.showKind.image") private var showImages = false
    @AppStorage("melonpan.drive.showKind.video") private var showVideos = false
    @AppStorage("melonpan.drive.showKind.audio") private var showAudio = false
    @AppStorage("melonpan.drive.showKind.text") private var showTextFiles = false
    @AppStorage("melonpan.drive.showKind.other") private var showOtherFiles = false
    @State private var sidebarTree = DriveTree.empty
    @State private var sidebarSearch = ""
    @State private var sidebarOpeningDocumentId: String? = nil
    @State private var showSidebarSignIn = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            theme.background.ignoresSafeArea()

            NavigationSplitView {
                workspaceSidebar
                    .frame(minWidth: 260, idealWidth: 310, maxWidth: 420)
            } detail: {
                editorWorkspace
                    .frame(minWidth: 600)
            }

            AppStatusBannerStack()
                .frame(maxWidth: 720, alignment: .topTrailing)
                .padding(.top, 8)
                .padding(.trailing, 14)
                .zIndex(1)
        }
        .background(theme.background)
        .frame(minWidth: 900, minHeight: 600)
        .onAppear {
            statusCenter.requestSignIn = {
                session.showSignInSheet = true
            }
        }
        .onChange(of: session.showShortcutsHelp) { visible in
            guard visible else { return }
            openWindow(id: "help")
            session.showShortcutsHelp = false
        }
        .onChange(of: session.pendingUtilityWindow) { pane in
            guard let pane else { return }
            openUtilityWindow(pane)
            session.pendingUtilityWindow = nil
        }
        .onChange(of: session.driveTreeReloadToken) { _ in
            reloadSidebarTree()
        }
        .onChange(of: session.cacheRoot) { _ in
            reloadSidebarTree()
        }
        .sheet(isPresented: $session.showSignInSheet) {
            SignInSheet()
                .environmentObject(session)
                .environmentObject(statusCenter)
        }
        .sheet(isPresented: $showSidebarSignIn) {
            SignInSheet()
                .environmentObject(session)
                .environmentObject(statusCenter)
        }
        .onChange(of: session.showOnboardingSheet) { visible in
            guard visible else { return }
            session.resetOnboarding()
        }
    }

    private var workspaceSidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Melon Pan")
                    .font(.melonPanUI(appUIFont, relativeSize: 2, weight: .semibold))
                    .lineLimit(1)

                Spacer(minLength: 8)

                Button {
                    session.newLocalDraft()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(.borderless)
                .help("New Local Draft")

                Button {
                    session.refreshDriveTree()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(session.activeAccount == nil || session.driveRefreshing)
                .help("Refresh Drive")

                utilityMenu
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 10)

            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search Drive", text: $sidebarSearch)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(theme.surface.opacity(0.86), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            if session.activeAccount == nil {
                WorkspaceSidebarEmptyState(
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    title: "Sign in to load Drive",
                    message: "Connect Google Drive to show folders and Docs here.",
                    buttonTitle: "Sign in",
                    action: { showSidebarSignIn = true }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if visibleSidebarNodes.isEmpty {
                WorkspaceSidebarEmptyState(
                    systemImage: session.driveRefreshing ? "arrow.clockwise" : "folder",
                    title: sidebarEmptyTitle,
                    message: sidebarEmptyMessage,
                    buttonTitle: sidebarEmptyButtonTitle,
                    action: sidebarEmptyAction
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    OutlineGroup(visibleSidebarNodes, children: \.children) { node in
                        workspaceSidebarRow(node)
                    }
                }
                .listStyle(.sidebar)
                .background(theme.sidebar)
            }
        }
        .background(theme.sidebar)
        .onAppear {
            reloadSidebarTree()
        }
    }

    @ViewBuilder
    private var editorWorkspace: some View {
        if let active = session.activeDocument {
            VStack(spacing: 0) {
                if session.openDocuments.count > 0 {
                    TabStrip()
                }
                EditorPane(document: active)
            }
        } else if !session.openDocuments.isEmpty {
            let _ = DispatchQueue.main.async {
                session.activeDocumentId = session.openDocuments.first?.id
            }
            WelcomeView()
        } else {
            WelcomeView()
        }
    }

    private var utilityMenu: some View {
        Menu {
            Button {
                session.openUtilityWindow(.graph)
            } label: {
                Label("Graph", systemImage: AppSession.Pane.graph.systemImage)
            }
            Button {
                session.openUtilityWindow(.templates)
            } label: {
                Label("Templates", systemImage: AppSession.Pane.templates.systemImage)
            }
            Button {
                session.openUtilityWindow(.conflicts)
            } label: {
                Label("Conflicts", systemImage: AppSession.Pane.conflicts.systemImage)
            }
            Button {
                session.openUtilityWindow(.diagnostics)
            } label: {
                Label("Diagnostics", systemImage: AppSession.Pane.diagnostics.systemImage)
            }
            Divider()
            Button {
                session.showHistory(documentId: nil)
                session.openUtilityWindow(.history)
            } label: {
                Label("History", systemImage: AppSession.Pane.history.systemImage)
            }
            Divider()
            Button {
                openSettingsWindow(section: "workspace")
            } label: {
                Label("Drive File Visibility...", systemImage: "line.3.horizontal.decrease.circle")
            }
            Button {
                session.openUtilityWindow(.help)
            } label: {
                Label("Help", systemImage: AppSession.Pane.help.systemImage)
            }
            Button {
                openSettingsWindow(section: nil)
            } label: {
                Label("Settings", systemImage: AppSession.Pane.settings.systemImage)
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .help("More")
    }

    private func workspaceSidebarRow(_ node: DriveNode) -> some View {
        let item = node.item
        let isActive = session.activeDocument?.documentId == item.id
        return HStack(spacing: 8) {
            Image(systemName: item.systemImage)
                .foregroundStyle(sidebarIconForeground(for: item))
                .frame(width: 16)

            Text(item.name)
                .lineLimit(1)
                .foregroundStyle(sidebarFileForeground(for: item))

            Spacer(minLength: 6)

            if item.isFolder {
                FolderChildSummary(children: node.children ?? [])
            }

            if sidebarOpeningDocumentId == item.id {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .background {
            if isActive {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(theme.selection.opacity(0.75))
            }
        }
        .onTapGesture {
            guard item.isDocument else { return }
            openSidebarDocument(item)
        }
        .contextMenu {
            if item.isDocument {
                Button {
                    openSidebarDocument(item)
                } label: {
                    Label("Open", systemImage: "doc.text")
                }
            }
        }
        .help(sidebarFileHelp(for: item))
    }

    private var visibleSidebarNodes: [DriveNode] {
        let roots = DriveTreeIndex.build(from: sidebarTree)
        let workspaceRoots = workspaceVisibilityFilteredNodes(roots)
        let query = sidebarSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        return workspaceRoots.compactMap { filterSidebarNode($0, query: query, ancestorMatchesQuery: false) }
    }

    private var workspaceVisibilityIsSelected: Bool {
        session.settings.mac.workspaceVisibilityMode == "selected"
    }

    private var sidebarEmptyTitle: String {
        if session.driveRefreshing { return "Refreshing Drive" }
        if sidebarTree.files.isEmpty { return "No Drive files" }
        if workspaceVisibilityIsSelected { return "No visible Drive files" }
        return "No matching Drive files"
    }

    private var sidebarEmptyMessage: String {
        if let phase = session.driveRefreshPhase {
            return phase
        }
        if sidebarTree.files.isEmpty {
            return "Refresh Drive to cache your folders and Google Docs."
        }
        if workspaceVisibilityIsSelected {
            return "Adjust workspace visibility in Settings to show more folders or files."
        }
        return "Change search or file-kind filters to show more cached items."
    }

    private var sidebarEmptyButtonTitle: String? {
        if session.driveRefreshing { return nil }
        if sidebarTree.files.isEmpty { return "Refresh" }
        if workspaceVisibilityIsSelected { return "Settings" }
        return nil
    }

    private var sidebarEmptyAction: (() -> Void)? {
        if session.driveRefreshing { return nil }
        if sidebarTree.files.isEmpty { return { session.refreshDriveTree() } }
        if workspaceVisibilityIsSelected {
            return {
                openSettingsWindow(section: "workspace")
            }
        }
        return nil
    }

    private func workspaceVisibilityFilteredNodes(_ nodes: [DriveNode]) -> [DriveNode] {
        guard workspaceVisibilityIsSelected else { return nodes }
        let selectedIDs = Set(session.settings.mac.workspaceVisibleDriveIds)
        guard !selectedIDs.isEmpty else { return [] }
        return nodes.compactMap {
            workspaceVisibilityFilteredNode($0, selectedIDs: selectedIDs, inheritedSelection: false)
        }
    }

    private func workspaceVisibilityFilteredNode(
        _ node: DriveNode,
        selectedIDs: Set<String>,
        inheritedSelection: Bool
    ) -> DriveNode? {
        let includeSubtree = inheritedSelection || selectedIDs.contains(node.id)
        if includeSubtree {
            return node
        }
        guard let children = node.children else { return nil }
        let visibleChildren = children.compactMap {
            workspaceVisibilityFilteredNode($0, selectedIDs: selectedIDs, inheritedSelection: false)
        }
        guard !visibleChildren.isEmpty else { return nil }
        return DriveNode(id: node.id, item: node.item, children: visibleChildren)
    }

    private func filterSidebarNode(
        _ node: DriveNode,
        query: String,
        ancestorMatchesQuery: Bool
    ) -> DriveNode? {
        let queryMatches = query.isEmpty || node.item.name.localizedCaseInsensitiveContains(query)
        let descendantShouldIgnoreQuery = ancestorMatchesQuery || queryMatches
        let childMatches = node.children?.compactMap {
            filterSidebarNode(
                $0,
                query: query,
                ancestorMatchesQuery: descendantShouldIgnoreQuery
            )
        }

        if node.item.isFolder {
            if childMatches?.isEmpty == false {
                return DriveNode(id: node.id, item: node.item, children: childMatches ?? [])
            }
            return nil
        }

        guard shouldShowFileKind(node.item.fileKind) else { return nil }
        guard descendantShouldIgnoreQuery || queryMatches else { return nil }
        return DriveNode(id: node.id, item: node.item, children: nil)
    }

    private var sidebarIncludesOnlyEditableFiles: Bool {
        showGoogleDocs &&
            !showGoogleSheets &&
            !showGoogleSlides &&
            !showPDFs &&
            !showImages &&
            !showVideos &&
            !showAudio &&
            !showTextFiles &&
            !showOtherFiles
    }

    private func shouldShowFileKind(_ kind: DriveFileKind) -> Bool {
        switch kind {
        case .googleDoc: return showGoogleDocs
        case .googleSheet: return showGoogleSheets
        case .googleSlide: return showGoogleSlides
        case .pdf: return showPDFs
        case .image: return showImages
        case .video: return showVideos
        case .audio: return showAudio
        case .text: return showTextFiles
        case .other: return showOtherFiles
        }
    }

    private func sidebarFileHelp(for item: DriveItem) -> String {
        if item.isDocument { return "Open document." }
        if item.isFolder { return "Folder" }
        return sidebarIncludesOnlyEditableFiles
            ? "Hidden by default unless non-editable files are enabled."
            : "Non-editable Drive file."
    }

    private func sidebarFileForeground(for item: DriveItem) -> Color {
        if item.isDocument { return theme.foreground }
        if item.isFolder { return theme.secondaryForeground }
        return theme.secondaryForeground.opacity(0.65)
    }

    private func sidebarIconForeground(for item: DriveItem) -> Color {
        if item.isDocument { return theme.secondaryForeground }
        return theme.secondaryForeground.opacity(0.65)
    }

    private func reloadSidebarTree() {
        sidebarTree = DriveTree.load(from: session.cacheRoot)
    }

    private func openSidebarDocument(_ item: DriveItem) {
        guard sidebarOpeningDocumentId == nil else { return }
        if session.openDocuments.contains(where: { $0.documentId == item.id }) ||
            RuntimeBridge.rehydrateDocument(cacheRoot: session.cacheRoot, documentId: item.id) != nil
        {
            session.openDocumentById(item.id)
            return
        }

        sidebarOpeningDocumentId = item.id
        session.beginDocumentFetch(id: item.id, title: item.name, revision: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            if sidebarOpeningDocumentId == item.id {
                sidebarOpeningDocumentId = nil
            }
        }
    }

    private func openUtilityWindow(_ pane: AppSession.Pane) {
        switch pane {
        case .graph:
            openWindow(id: "graph")
        case .templates:
            openWindow(id: "templates")
        case .conflicts:
            openWindow(id: "conflicts")
        case .diagnostics:
            openWindow(id: "diagnostics")
        case .history:
            openWindow(id: "history")
        case .help:
            openWindow(id: "help")
        case .settings:
            openSettingsWindow(section: nil)
        case .importer:
            openWindow(id: "import")
        case .home, .drive:
            break
        }
    }

    private func openSettingsWindow(section: String?) {
        if let section {
            session.pendingSettingsSection = section
        }
        MelonPanSettingsWindowController.shared.showPendingSection(
            session: session,
            statusCenter: statusCenter
        )
    }
}

private struct WorkspaceSidebarEmptyState: View {
    @Environment(\.appTheme) private var theme
    @Environment(\.appUIFont) private var appUIFont
    let systemImage: String
    let title: String
    let message: String
    let buttonTitle: String?
    let action: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(theme.secondaryForeground)

            Text(title)
                .font(.melonPanUI(appUIFont, relativeSize: 1, weight: .semibold))

            Text(message)
                .font(.melonPanUI(appUIFont, relativeSize: -1))
                .foregroundStyle(theme.secondaryForeground)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .frame(maxWidth: 220)

            if let buttonTitle, let action {
                Button(buttonTitle, action: action)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(18)
    }
}

private struct FolderChildSummary: View {
    @Environment(\.appTheme) private var theme
    let children: [DriveNode]

    private var folderCount: Int {
        children.filter { $0.item.isFolder }.count
    }

    private var fileCount: Int {
        children.filter { !$0.item.isFolder }.count
    }

    var body: some View {
        HStack(spacing: 5) {
            if folderCount > 0 {
                countChip(systemImage: "folder", count: folderCount)
            }
            if fileCount > 0 {
                countChip(systemImage: "doc.text", count: fileCount)
            }
            if folderCount == 0 && fileCount == 0 {
                countChip(systemImage: "tray", count: 0)
            }
        }
        .font(.caption2.monospacedDigit())
        .foregroundStyle(theme.secondaryForeground)
        .layoutPriority(1)
        .accessibilityLabel(summaryLabel)
    }

    private func countChip(systemImage: String, count: Int) -> some View {
        HStack(spacing: 2) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .medium))
            Text("\(count)")
                .font(.system(size: 10, weight: .medium, design: .rounded))
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(theme.surface.opacity(0.85), in: Capsule())
    }

    private var summaryLabel: String {
        "\(folderCount) folders, \(fileCount) files"
    }
}

/// Horizontal tab strip above the editor. One pill per open document;
/// click to focus, ⌘W or the × button to close.
private struct TabStrip: View {
    @Environment(\.openWindow) private var openWindow
    @Environment(\.appTheme) private var theme
    @Environment(\.appUIFont) private var appUIFont
    @EnvironmentObject private var session: AppSession

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(session.openDocuments) { document in
                    tabPill(for: document)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .background(theme.elevatedSurface)
        .overlay(Divider().background(theme.separator), alignment: .bottom)
        .frame(maxWidth: .infinity)
    }

    private func tabPill(for document: OpenDocument) -> some View {
        let isActive = session.activeDocumentId == document.id
        return HStack(spacing: 6) {
            Image(systemName: "doc.text")
                .font(.caption)
                .foregroundStyle(isActive ? theme.foreground : theme.secondaryForeground)
            Text(document.title.isEmpty ? "Untitled" : document.title)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 220)
                .font(.melonPanUI(
                    appUIFont,
                    relativeSize: -2,
                    weight: isActive ? .semibold : .regular
                ))
                .foregroundStyle(isActive ? theme.foreground : theme.secondaryForeground)
            Button {
                session.closeTab(document.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(theme.secondaryForeground)
                    .padding(2)
            }
            .buttonStyle(.borderless)
            .help("Close tab")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isActive ? theme.selection.opacity(0.75) : Color.clear)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            session.selectTab(document.id)
        }
        .contextMenu {
            Button {
                session.showHistory(documentId: document.documentId)
                openWindow(id: "history")
            } label: {
                Label("Show in History…", systemImage: "clock.arrow.circlepath")
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AppSession())
        .environmentObject(AppStatusCenter.shared)
}
