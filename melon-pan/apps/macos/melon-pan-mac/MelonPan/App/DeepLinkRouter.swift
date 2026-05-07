import AppKit
import Foundation

enum DeepLinkRouter {
    static let scheme = "melonpan"
    static let maxParamLength = 2048
    static let maxIdLength = 256
    static let maxPathDepth = 4

    static let allowedPanes: Set<String> = [
        "home", "drive", "conflicts", "diagnostics", "settings",
        "templates", "import", "history", "help"
    ]
    static let allowedCommands: Set<String> = [
        "push", "pull", "drain", "signin", "signout",
        "refresh-drive", "open-cache-folder"
    ]
    static let allowedSettingsSections: Set<String> = [
        "general", "account", "accounts", "oauth", "sync", "editor", "appearance",
        "advanced", "diagnostics", "updates", "about", "workspace", "drive",
        "sidebar", "visibility", "keys", "keybindings", "shortcuts", "privacy",
        "security", "encryption", "history"
    ]

    static var rateLimiter = TokenBucket(capacity: 8, refillPerSecond: 4)

    static func parse(_ url: URL) -> Result<DeepLink, DeepLinkError> {
        guard url.scheme?.lowercased() == scheme else {
            return .failure(.init(message: "Not a melonpan:// URL."))
        }
        guard let host = url.host?.lowercased(), !host.isEmpty else {
            return .failure(.init(message: "Missing route."))
        }

        let path = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        guard path.count <= maxPathDepth else {
            return .failure(.init(message: "Path too deep."))
        }

        if let oversizedPath = path.first(where: { $0.count > maxIdLength }) {
            return .failure(.init(message: "Path component '\(oversizedPath.prefix(32))' too long."))
        }

        let params = parseParams(url: url)
        if let bad = params.first(where: { $0.value.count > maxParamLength }) {
            return .failure(.init(message: "Param '\(bad.key)' too long."))
        }

        switch host {
        case "open", "home":
            return .success(.openApp)
        case "document":
            guard let id = path.first, !id.isEmpty else {
                return .failure(.init(message: "Missing or invalid document id."))
            }
            let revision = params["revision"]?.nonEmptyTrimmed
            if let revision, revision.count > maxIdLength {
                return .failure(.init(message: "Revision id too long."))
            }
            return .success(.openDocument(id: id, revision: revision))
        case "drive":
            return .success(.openDrive(folderId: path.first))
        case "pane":
            guard let name = path.first?.lowercased(),
                  allowedPanes.contains(name),
                  let pane = AppSession.Pane(deepLinkName: name)
            else {
                return .failure(.init(message: "Unknown or unimplemented pane."))
            }
            return .success(.switchPane(pane))
        case "palette":
            return .success(.openPalette(query: params["q"]?.nonEmptyTrimmed))
        case "command":
            guard let command = path.first?.lowercased(),
                  allowedCommands.contains(command)
            else {
                return .failure(.init(message: "Unknown command."))
            }
            return .success(.runCommand(id: command))
        case "new":
            return .success(.newDraft(
                title: params["title"]?.nonEmptyTrimmed,
                body: params["body"]?.nonEmptyTrimmed
            ))
        case "history":
            return .success(.openHistory)
        case "settings":
            let section = path.first?.lowercased()
            if let section, !allowedSettingsSections.contains(section) {
                return .failure(.init(message: "Unknown settings section."))
            }
            return .success(.openSettings(section: section))
        case "onboarding":
            return .success(.openOnboarding)
        default:
            return .failure(.init(message: "Unknown route '\(host)'."))
        }
    }

    @MainActor
    static func handle(_ url: URL, session: AppSession) {
        guard rateLimiter.allow() else {
            session.postStatusBanner("Deep-link flood - slow down.", kind: .warning)
            return
        }

        switch parse(url) {
        case .failure(let error):
            session.postStatusBanner("Bad link: \(error.message)", kind: .warning)
        case .success(let link):
            apply(link, session: session)
        }
    }

    @MainActor
    static func resetRateLimiterForTesting() {
        rateLimiter = TokenBucket(capacity: 8, refillPerSecond: 4)
    }

    @MainActor
    private static func apply(_ link: DeepLink, session: AppSession) {
        switch link {
        case .openApp:
            NSApp.activate(ignoringOtherApps: true)
        case .openDocument(let id, let revision):
            session.activePane = .home
            if let cached = RuntimeBridge.rehydrateDocument(
                cacheRoot: session.cacheRoot,
                documentId: id
            ) {
                session.openInTab(OpenDocument(
                    documentId: cached.documentId,
                    title: cached.title,
                    plainText: cached.plainText
                ))
                if let revision {
                    session.pinRevision(revision, for: id)
                }
            } else {
                session.beginDocumentFetch(id: id, revision: revision)
            }
        case .openDrive(let folderId):
            session.activePane = .drive
            session.driveFocusFolderId = folderId
        case .switchPane(let pane):
            switch pane {
            case .graph, .templates, .conflicts, .diagnostics, .settings, .history, .help, .importer:
                session.activePane = pane
                session.openUtilityWindow(pane)
            case .home, .drive:
                session.activePane = pane
            }
        case .openPalette(let query):
            session.pendingPalettePrefill = query ?? ""
            session.paletteVisible = true
        case .runCommand(let id):
            session.runRegisteredCommand(id: id)
        case .newDraft(let title, let body):
            session.newLocalDraft(title: title, body: body)
        case .openHistory:
            session.openUtilityWindow(.history)
        case .openSettings(let section):
            session.pendingSettingsSection = section
            session.openUtilityWindow(.settings)
        case .openOnboarding:
            session.showOnboardingSheet = true
        }
    }

    private static func parseParams(url: URL) -> [String: String] {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems
        else {
            return [:]
        }
        var output: [String: String] = [:]
        for item in items {
            if let value = item.value {
                output[item.name.lowercased()] = value
            }
        }
        return output
    }
}

final class TokenBucket: @unchecked Sendable {
    private let capacity: Double
    private let refillPerSecond: Double
    private let lock = NSLock()
    private var tokens: Double
    private var lastRefill: Date

    init(capacity: Int, refillPerSecond: Double, now: Date = Date()) {
        self.capacity = Double(capacity)
        self.refillPerSecond = refillPerSecond
        self.tokens = Double(capacity)
        self.lastRefill = now
    }

    func allow(now: Date = Date()) -> Bool {
        lock.lock()
        defer { lock.unlock() }

        let elapsed = max(0, now.timeIntervalSince(lastRefill))
        tokens = min(capacity, tokens + elapsed * refillPerSecond)
        lastRefill = now

        guard tokens >= 1 else {
            return false
        }
        tokens -= 1
        return true
    }
}

private extension String {
    var nonEmptyTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
