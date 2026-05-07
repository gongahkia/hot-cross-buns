// Drive sidebar pane. Reads `<cache>/drive-tree.json` (written by
// melon_pan_refresh_drive_tree) and renders the result as a SwiftUI
// OutlineGroup. Selecting a Doc kicks off a pull through the FFI
// and adds it to AppSession.openDocuments; clicking a folder
// expands inline. Non-Doc files are visually greyed out.

import OSLog
import SwiftUI

private let driveRefreshLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "MelonPan",
    category: "DriveRefresh"
)

enum DriveRefreshTimeout {
    static let seconds: UInt64 = 45
    static let nanoseconds = seconds * 1_000_000_000
}

struct DrivePane: View {
    @EnvironmentObject private var session: AppSession
    @State private var tree = DriveTree.empty
    @State private var refreshing = false
    @State private var refreshPhase: String? = nil
    @State private var activeRefreshID: UUID? = nil
    @State private var refreshTimeoutTask: Task<Void, Never>? = nil
    @State private var lastError: String? = nil
    @State private var openingDocumentId: String? = nil
    @State private var openingDocumentName: String? = nil
    @State private var showSignIn = false
    @State private var focusedFolderId: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(focusedFolderId == nil ? "Drive" : "Drive folder")
                    .font(.title2)
                Spacer()
                if let openingDocumentName {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("Opening \(openingDocumentName)...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Button {
                    refresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(refreshing || session.activeAccount == nil)
            }

            if let lastError {
                Text(lastError)
                    .foregroundStyle(.red)
                    .font(.caption)
            }
            if focusedFolderId != nil {
                Button {
                    focusedFolderId = nil
                    session.driveFocusFolderId = nil
                } label: {
                    Label("Root", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(.borderless)
            }

            if session.activeAccount == nil {
                DriveEmptyState(
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    title: "Sign in to load Drive",
                    message: "Connect your Google account before refreshing the Drive tree.",
                    buttonTitle: "Sign in with Google",
                    action: { showSignIn = true }
                )
                .frame(maxWidth: .infinity, minHeight: 280)
            } else {
                driveList
                    .frame(minHeight: 280)
            }

            Divider()
            Text("Open documents (\(session.openDocuments.count))")
                .font(.headline)
            List(session.openDocuments) { document in
                Label(document.title, systemImage: "doc.text")
            }
            .frame(minHeight: 80)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            reloadTree()
            consumeFocusedFolder()
        }
        .onChange(of: session.driveFocusFolderId) { _ in
            consumeFocusedFolder()
        }
        .onChange(of: session.driveTreeReloadToken) { _ in
            reloadTree()
        }
        .onChange(of: session.activePane) { pane in
            if pane != .drive {
                openingDocumentId = nil
                openingDocumentName = nil
            }
        }
        .sheet(isPresented: $showSignIn) {
            SignInSheet()
                .environmentObject(session)
        }
    }

    @ViewBuilder
    private var driveList: some View {
        let nodes = visibleNodes
        if nodes.isEmpty {
            DriveEmptyState(
                systemImage: "externaldrive.badge.plus",
                title: "No Drive tree cached yet",
                message: refreshing
                    ? (refreshPhase ?? "Refreshing Drive...")
                    : "Refresh to cache your Google Docs and folders.",
                buttonTitle: nil,
                action: nil
            )
        } else {
            List {
                OutlineGroup(nodes, children: \.children) { node in
                    driveRow(item: node.item)
                }
            }
        }
    }

    @ViewBuilder
    private func driveRow(item: DriveItem) -> some View {
        HStack(spacing: 8) {
            Label(item.name, systemImage: item.systemImage)
                .foregroundStyle(item.isDocument ? .primary : .secondary)
            Spacer(minLength: 8)
            if openingDocumentId == item.id {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) {
            if item.isDocument {
                pull(item: item)
            }
        }
        .disabled(openingDocumentId != nil)
        .help(item.isDocument
            ? "Double-click to pull and open."
            : "Only Google Docs can be edited in Melon Pan.")
    }

    private func reloadTree() {
        tree = DriveTree.load(from: session.cacheRoot)
    }

    private var visibleNodes: [DriveNode] {
        let roots = DriveTreeIndex.build(from: tree)
        guard let focusedFolderId else { return roots }
        guard let node = findNode(id: focusedFolderId, in: roots),
              let children = node.children
        else {
            return roots
        }
        return children
    }

    private func consumeFocusedFolder() {
        focusedFolderId = session.driveFocusFolderId
    }

    private func findNode(id: String, in nodes: [DriveNode]) -> DriveNode? {
        for node in nodes {
            if node.id == id {
                return node
            }
            if let children = node.children,
               let match = findNode(id: id, in: children) {
                return match
            }
        }
        return nil
    }

    private func refresh() {
        guard let account = session.activeAccount else { return }
        guard GoogleScopeSupport.canListDrive(RuntimeBridge.tokenMetadata(account: account)) else {
            let message = GoogleScopeSupport.missingDriveListScopeMessage
            lastError = message
            AppStatusCenter.shared.post(StatusBanner(
                dedupeKey: "drive-refresh",
                kind: .warning,
                title: "Drive refresh needs sign-in",
                detail: message,
                primaryAction: BannerAction(label: "Sign in") {
                    showSignIn = true
                },
                autoDismissAfter: nil,
                canDismiss: true
            ))
            return
        }
        let refreshID = UUID()
        activeRefreshID = refreshID
        refreshing = true
        refreshPhase = "Preparing Drive refresh..."
        lastError = nil
        refreshTimeoutTask?.cancel()
        refreshTimeoutTask = Task {
            try? await Task.sleep(nanoseconds: DriveRefreshTimeout.nanoseconds)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard activeRefreshID == refreshID else { return }
                driveRefreshLogger.error("Drive pane refresh timed out after \(DriveRefreshTimeout.seconds, privacy: .public)s")
                activeRefreshID = nil
                refreshing = false
                refreshPhase = nil
                AppStatusCenter.shared.clear(dedupeKey: "sync")
                AppStatusCenter.shared.post(StatusBanner(
                    dedupeKey: "drive-refresh",
                    kind: .warning,
                    title: "Drive refresh timed out",
                    detail: "Google Drive did not respond within \(DriveRefreshTimeout.seconds) seconds. Check the app logs for the last completed refresh phase, then retry.",
                    primaryAction: BannerAction(label: "Retry") {
                        refresh()
                    },
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
            }
        }
        let credentials = session.credentialsPath
        let cacheRoot = session.cacheRoot
        Task.detached(priority: .userInitiated) {
            let startedAt = Date()
            driveRefreshLogger.info("Drive pane refresh started; cacheRoot=\(cacheRoot, privacy: .private)")
            do {
                await MainActor.run {
                    guard activeRefreshID == refreshID else { return }
                    refreshPhase = "Getting a Google access token..."
                    AppStatusCenter.shared.postSyncing(
                        title: "Refreshing Drive",
                        detail: refreshPhase,
                        autoDismissAfter: nil
                    )
                }
                let token = try RuntimeBridge.ensureFreshAccessToken(
                    credentialsPath: credentials,
                    account: account,
                    leewaySeconds: 30
                )
                driveRefreshLogger.info("Drive pane refresh token phase complete")
                await MainActor.run {
                    guard activeRefreshID == refreshID else { return }
                    refreshPhase = "Loading Google Drive files..."
                    AppStatusCenter.shared.postSyncing(
                        title: "Refreshing Drive",
                        detail: refreshPhase,
                        autoDismissAfter: nil
                    )
                }
                let count = try RuntimeBridge.refreshDriveTree(
                    accessToken: token,
                    parentId: nil,
                    cacheRoot: cacheRoot
                )
                let elapsed = Date().timeIntervalSince(startedAt)
                driveRefreshLogger.info("Drive pane refresh finished; itemCount=\(count, privacy: .public) elapsed=\(elapsed, privacy: .public)s")
                await MainActor.run {
                    guard activeRefreshID == refreshID else {
                        driveRefreshLogger.info("Ignoring stale Drive pane refresh completion")
                        return
                    }
                    refreshTimeoutTask?.cancel()
                    activeRefreshID = nil
                    reloadTree()
                    if count == 0 {
                        lastError = "Google returned zero Drive items for this account. Check that you signed in to the expected Google account and that Drive access is enabled for this OAuth client."
                    }
                    refreshing = false
                    refreshPhase = nil
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    if count == 0 {
                        AppStatusCenter.shared.post(StatusBanner(
                            dedupeKey: "drive-refresh",
                            kind: .warning,
                            title: "Drive returned no files",
                            detail: lastError,
                            autoDismissAfter: nil,
                            canDismiss: true
                        ))
                    } else {
                        AppStatusCenter.shared.clear(dedupeKey: "drive-refresh")
                    }
                }
            } catch {
                driveRefreshLogger.error("Drive pane refresh failed: \(String(describing: error), privacy: .public)")
                await MainActor.run {
                    guard activeRefreshID == refreshID else {
                        driveRefreshLogger.info("Ignoring stale Drive pane refresh failure")
                        return
                    }
                    refreshTimeoutTask?.cancel()
                    activeRefreshID = nil
                    let message = UserFacingError.message(from: error)
                    lastError = nil
                    refreshing = false
                    refreshPhase = nil
                    AppStatusCenter.shared.clear(dedupeKey: "sync")
                    AppStatusCenter.shared.post(StatusBanner(
                        dedupeKey: "drive-refresh",
                        kind: .warning,
                        title: "Drive refresh failed",
                        detail: message,
                        primaryAction: BannerAction(label: "Retry") {
                            refresh()
                        },
                        autoDismissAfter: nil,
                        canDismiss: true
                    ))
                }
            }
        }
    }

    private func pull(item: DriveItem) {
        guard session.activeAccount != nil else {
            lastError = "Sign in first."
            return
        }
        guard openingDocumentId == nil else { return }
        openingDocumentId = item.id
        openingDocumentName = item.name
        lastError = nil
        AppStatusCenter.shared.postSyncing(title: "Opening Google Doc", detail: item.name)
        session.beginDocumentFetch(id: item.id, title: item.name, revision: nil)
    }
}

private struct DriveEmptyState: View {
    let systemImage: String
    let title: String
    let message: String
    let buttonTitle: String?
    let action: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.secondary)

            Text(title)
                .font(.headline)

            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: 320)

            if let buttonTitle, let action {
                Button(action: action) {
                    Label(buttonTitle, systemImage: "person.crop.circle.badge.plus")
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity, alignment: .center)
    }
}
