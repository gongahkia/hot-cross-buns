import AppKit
import SwiftUI

struct StatusBanner: Identifiable, Equatable {
    let id: UUID
    let dedupeKey: String
    let kind: StatusBannerKind
    let title: String
    let detail: String?
    let primaryAction: BannerAction?
    let secondaryAction: BannerAction?
    let autoDismissAfter: TimeInterval?
    let canDismiss: Bool
    let postedAt: Date

    init(
        dedupeKey: String? = nil,
        kind: StatusBannerKind,
        title: String,
        detail: String? = nil,
        primaryAction: BannerAction? = nil,
        secondaryAction: BannerAction? = nil,
        autoDismissAfter: TimeInterval? = nil,
        canDismiss: Bool = true,
        postedAt: Date = Date()
    ) {
        id = UUID()
        self.dedupeKey = dedupeKey ?? "\(kind):\(title)"
        self.kind = kind
        self.title = title
        self.detail = detail.map(UserFacingError.message(from:))
        self.primaryAction = primaryAction
        self.secondaryAction = secondaryAction
        self.autoDismissAfter = autoDismissAfter
        self.canDismiss = canDismiss
        self.postedAt = postedAt
    }
}

struct BannerAction: Equatable {
    let label: String
    let handler: () -> Void

    static func == (left: BannerAction, right: BannerAction) -> Bool {
        left.label == right.label
    }
}

enum StatusBannerKind: Int, Comparable {
    case info
    case success
    case warning
    case error

    static func < (left: Self, right: Self) -> Bool {
        left.rawValue < right.rawValue
    }

    var systemImage: String {
        switch self {
        case .info: return "info.circle"
        case .success: return "checkmark.circle"
        case .warning: return "exclamationmark.triangle"
        case .error: return "xmark.octagon"
        }
    }

    var tint: Color {
        switch self {
        case .info: return .accentColor
        case .success: return .green
        case .warning: return .orange
        case .error: return .red
        }
    }
}

@MainActor
final class AppStatusCenter: ObservableObject {
    static let shared = AppStatusCenter()

    @Published private(set) var banners: [StatusBanner] = []
    @Published private(set) var overflowCount = 0
    @Published private(set) var isOffline = false

    var openDiagnostics: (() -> Void)?
    var openConflicts: (() -> Void)?
    var requestSignIn: (() -> Void)?
    var retryBootstrap: (() -> Void)?

    private let cap = 4
    private var dismissTasks: [UUID: Task<Void, Never>] = [:]

    func post(_ banner: StatusBanner) {
        if let index = banners.firstIndex(where: { $0.dedupeKey == banner.dedupeKey }) {
            cancelAutoDismiss(banners[index].id)
            banners[index] = banner
        } else {
            banners.append(banner)
            enforceCap()
        }
        scheduleAutoDismiss(for: banner)
        sortStable()
        announceIfNeeded(banner)
    }

    func dismiss(id: UUID) {
        cancelAutoDismiss(id)
        banners.removeAll { $0.id == id }
    }

    func dismissTop() {
        guard let banner = banners.first(where: \.canDismiss) else { return }
        dismiss(id: banner.id)
    }

    func clear(dedupeKey: String) {
        let removed = banners.filter { $0.dedupeKey == dedupeKey }
        removed.forEach { cancelAutoDismiss($0.id) }
        banners.removeAll { $0.dedupeKey == dedupeKey }
        if dedupeKey == "offline" {
            isOffline = false
        }
    }

    func clearAll() {
        banners.forEach { cancelAutoDismiss($0.id) }
        banners.removeAll()
        overflowCount = 0
    }

    func postSyncError(documentId: String, message: String) {
        let op: (key: String, title: String) = {
            if message.contains("pull_document") {
                return ("pull:\(documentId)", "Pull failed")
            }
            if message.contains("drain_pending") {
                return ("drain:\(documentId)", "Drain failed")
            }
            return ("push:\(documentId)", "Push failed")
        }()
        post(StatusBanner(
            dedupeKey: op.key,
            kind: .error,
            title: op.title,
            detail: message,
            secondaryAction: diagnosticsAction(),
            autoDismissAfter: nil,
            canDismiss: true
        ))
    }

    func postConflict(documentId: String) {
        post(StatusBanner(
            dedupeKey: "conflict:\(documentId)",
            kind: .warning,
            title: "Revision conflict",
            detail: "\(documentId) has a revision conflict. Open Conflicts to resolve it.",
            primaryAction: BannerAction(label: "Open Conflicts") { [weak self] in
                self?.openConflicts?()
            },
            secondaryAction: diagnosticsAction(),
            autoDismissAfter: nil,
            canDismiss: true
        ))
    }

    func postUpdateAvailable(latestVersion: String, releaseUrl: String) {
        post(StatusBanner(
            dedupeKey: "update-\(latestVersion)",
            kind: .info,
            title: "Update available",
            detail: "Version \(latestVersion) is ready.",
            primaryAction: BannerAction(label: "Open Releases") {
                RuntimeBridge.openURL(releaseUrl)
            },
            autoDismissAfter: 6,
            canDismiss: true
        ))
    }

    func postOffline() {
        isOffline = true
        post(StatusBanner(
            dedupeKey: "offline",
            kind: .warning,
            title: "You're offline",
            detail: "Edits queue locally; sync resumes when network returns.",
            autoDismissAfter: nil,
            canDismiss: true
        ))
    }

    func postQueuedChangesAvailable(
        count: Int,
        syncAction: @escaping () -> Void,
        conflictsAction: @escaping () -> Void
    ) {
        guard count > 0 else { return }
        post(StatusBanner(
            dedupeKey: "queued-sync",
            kind: .info,
            title: "Queued changes ready to sync",
            detail: "\(count) document(s) have local edits waiting.",
            primaryAction: BannerAction(label: "Sync queued") {
                syncAction()
            },
            secondaryAction: BannerAction(label: "Open Conflicts") {
                conflictsAction()
            },
            autoDismissAfter: nil,
            canDismiss: true
        ))
    }

    func postDrift(documentId: String, title: String) {
        post(StatusBanner(
            dedupeKey: "drift:\(documentId)",
            kind: .warning,
            title: "Audit drift on \(title)",
            detail: "Cached rich Docs JSON could not be validated.",
            primaryAction: diagnosticsAction(),
            autoDismissAfter: nil,
            canDismiss: false
        ))
    }

    func postSyncing(
        title: String = "Syncing...",
        detail: String? = nil,
        autoDismissAfter: TimeInterval? = 6
    ) {
        post(StatusBanner(
            dedupeKey: "sync",
            kind: .info,
            title: title,
            detail: detail,
            autoDismissAfter: autoDismissAfter,
            canDismiss: true
        ))
    }

    func postSyncSucceeded(revisionId: String?) {
        post(StatusBanner(
            dedupeKey: "sync",
            kind: .success,
            title: "Saved to Google Docs",
            detail: revisionId,
            autoDismissAfter: 4,
            canDismiss: true
        ))
    }

    func diagnosticsAction() -> BannerAction {
        BannerAction(label: "View Diagnostics") { [weak self] in
            self?.openDiagnostics?()
        }
    }

    private func enforceCap() {
        guard banners.count > cap else { return }
        let dropIndex = banners.firstIndex(where: { $0.kind == .info })
            ?? banners.firstIndex(where: { $0.kind == .success })
            ?? banners.enumerated().min(by: { $0.element.postedAt < $1.element.postedAt })?.offset
        guard let dropIndex else { return }
        cancelAutoDismiss(banners[dropIndex].id)
        banners.remove(at: dropIndex)
        overflowCount += 1
    }

    private func scheduleAutoDismiss(for banner: StatusBanner) {
        guard let seconds = banner.autoDismissAfter else { return }
        dismissTasks[banner.id] = Task { [weak self] in
            let nanos = UInt64(seconds * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanos)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.dismiss(id: banner.id)
            }
        }
    }

    private func cancelAutoDismiss(_ id: UUID) {
        dismissTasks[id]?.cancel()
        dismissTasks.removeValue(forKey: id)
    }

    private func sortStable() {
        banners.sort { first, second in
            first.kind == second.kind
                ? first.postedAt < second.postedAt
                : first.kind > second.kind
        }
    }

    private func announceIfNeeded(_ banner: StatusBanner) {
        guard banner.kind == .error || banner.kind == .warning else { return }
        let message = [banner.title, banner.detail]
            .compactMap { $0 }
            .joined(separator: ". ")
        let priority: NSAccessibilityPriorityLevel =
            banner.kind == .error ? .high : .medium
        NSAccessibility.post(
            element: NSApp as Any,
            notification: .announcementRequested,
            userInfo: [
                .announcement: message,
                .priority: priority.rawValue
            ]
        )
    }

    nonisolated static func postFromBridge(_ error: RuntimeBridgeError, op: String) {
        let detail = String(describing: error)
        let message = UserFacingError.message(from: detail)
        Task { @MainActor in
            if detail.localizedCaseInsensitiveContains("Keychain") {
                shared.post(StatusBanner(
                    dedupeKey: "keychain",
                    kind: .warning,
                    title: "Keychain access pending",
                    detail: "macOS is asking for permission to read the stored token.",
                    primaryAction: BannerAction(label: "Open Keychain Access") {
                        RuntimeBridge.openURL("/System/Library/CoreServices/Keychain Access.app")
                    },
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
                return
            }
            if op == "ensureFreshAccessToken" {
                shared.post(StatusBanner(
                    dedupeKey: "sign-in-expired",
                    kind: .warning,
                    title: "Sign-in expired",
                    detail: "Reconnect Google to keep syncing.",
                    primaryAction: BannerAction(label: "Sign in") {
                        shared.requestSignIn?()
                    },
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
                return
            }
            if op.hasPrefix("push:") {
                let documentId = String(op.dropFirst("push:".count))
                shared.post(StatusBanner(
                    dedupeKey: "push:\(documentId)",
                    kind: .error,
                    title: "Push failed",
                    detail: message,
                    secondaryAction: shared.diagnosticsAction(),
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
                return
            }
            if op.hasPrefix("pull:") {
                let documentId = String(op.dropFirst("pull:".count))
                shared.post(StatusBanner(
                    dedupeKey: "pull:\(documentId)",
                    kind: .error,
                    title: "Pull failed",
                    detail: message,
                    secondaryAction: shared.diagnosticsAction(),
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
                return
            }
            if op.hasPrefix("drain:") {
                let documentId = String(op.dropFirst("drain:".count))
                shared.post(StatusBanner(
                    dedupeKey: "drain:\(documentId)",
                    kind: .error,
                    title: "Drain failed",
                    detail: message,
                    secondaryAction: shared.diagnosticsAction(),
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
                return
            }
            if op == "refreshDriveTree" {
                shared.post(StatusBanner(
                    dedupeKey: "drive-refresh",
                    kind: .warning,
                    title: "Drive refresh failed",
                    detail: message,
                    autoDismissAfter: nil,
                    canDismiss: true
                ))
                return
            }
            shared.post(StatusBanner(
                dedupeKey: "ffi:\(op)",
                kind: .error,
                title: "\(op) failed",
                detail: message,
                secondaryAction: shared.diagnosticsAction(),
                autoDismissAfter: nil,
                canDismiss: true
            ))
        }
    }
}

struct AppStatusBannerStack: View {
    @EnvironmentObject private var center: AppStatusCenter
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 6) {
            ForEach(center.banners) { banner in
                AppStatusBanner(banner: banner) {
                    center.dismiss(id: banner.id)
                }
                .transition(transition)
            }
            if center.overflowCount > 0 {
                Button {
                    center.openDiagnostics?()
                } label: {
                    Text("+\(center.overflowCount) more")
                        .font(.caption)
                }
                .buttonStyle(.link)
                .accessibilityLabel("\(center.overflowCount) more status messages. Open Diagnostics.")
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, center.banners.isEmpty ? 0 : 8)
        .frame(maxHeight: center.banners.isEmpty ? 0 : 180, alignment: .top)
        .clipped()
        .animation(.easeInOut(duration: 0.18), value: center.banners)
        .background(EscapeKeyHandler {
            center.dismissTop()
        })
    }

    private var transition: AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .move(edge: .top).combined(with: .opacity)
    }
}

private struct EscapeKeyHandler: NSViewRepresentable {
    let action: () -> Void

    func makeNSView(context: Context) -> NSView {
        let view = KeyHandlingView()
        view.action = action
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        (nsView as? KeyHandlingView)?.action = action
    }

    private final class KeyHandlingView: NSView {
        var action: (() -> Void)?

        override var acceptsFirstResponder: Bool { true }

        override func viewDidMoveToWindow() {
            window?.makeFirstResponder(self)
        }

        override func keyDown(with event: NSEvent) {
            if event.keyCode == 53 {
                action?()
            } else {
                super.keyDown(with: event)
            }
        }
    }
}
