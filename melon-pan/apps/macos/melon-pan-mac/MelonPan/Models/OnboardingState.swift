import Foundation

struct OnboardingState: Codable, Equatable {
    static let currentSchemaVersion = 1
    var version: Int = OnboardingState.currentSchemaVersion
    var completedAt: Date?
    var lastStep: OnboardingStep = .welcome

    var welcomeAcknowledged = false
    var oauthClient: OAuthClientConfig?
    var signedInAccount: String?
    var scopesAcknowledged = false
    var cacheRootOverride: String?
    var encryption: EncryptionChoice = .skipped
    var notifications: NotificationsChoice = .undecided
    var defaultDriveFolderId: String?
    var workspaceVisibilityMode: String = "all"
    var workspaceVisibleDriveIds: [String] = []

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version)
            ?? OnboardingState.currentSchemaVersion
        completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        lastStep = try container.decodeIfPresent(OnboardingStep.self, forKey: .lastStep) ?? .welcome
        welcomeAcknowledged = try container.decodeIfPresent(Bool.self, forKey: .welcomeAcknowledged) ?? false
        oauthClient = try container.decodeIfPresent(OAuthClientConfig.self, forKey: .oauthClient)
        signedInAccount = try container.decodeIfPresent(String.self, forKey: .signedInAccount)
        scopesAcknowledged = try container.decodeIfPresent(Bool.self, forKey: .scopesAcknowledged) ?? false
        cacheRootOverride = try container.decodeIfPresent(String.self, forKey: .cacheRootOverride)
        encryption = try container.decodeIfPresent(EncryptionChoice.self, forKey: .encryption) ?? .skipped
        notifications = try container.decodeIfPresent(NotificationsChoice.self, forKey: .notifications) ?? .undecided
        defaultDriveFolderId = try container.decodeIfPresent(String.self, forKey: .defaultDriveFolderId)
        workspaceVisibilityMode = try container.decodeIfPresent(String.self, forKey: .workspaceVisibilityMode) ?? "all"
        workspaceVisibleDriveIds = try container.decodeIfPresent([String].self, forKey: .workspaceVisibleDriveIds) ?? []
    }

    struct OAuthClientConfig: Codable, Equatable {
        var clientId: String
        var hasSecret: Bool
    }

    enum EncryptionChoice: String, Codable, Equatable {
        case skipped, enabled, deferred
    }

    enum NotificationsChoice: String, Codable, Equatable {
        case undecided, granted, denied, skipped
    }

    var isComplete: Bool { completedAt != nil }
}

enum OnboardingStep: String, Codable, CaseIterable, Identifiable, Comparable {
    case welcome, oauthClient, signIn, scope, cacheRoot
    case encryption, notifications, driveFolder, done

    var id: String { rawValue }
    var index: Int { OnboardingStep.allCases.firstIndex(of: self) ?? 0 }

    var title: String {
        switch self {
        case .welcome: return "Welcome"
        case .oauthClient: return "OAuth Client"
        case .signIn: return "Sign In"
        case .scope: return "Scopes"
        case .cacheRoot: return "Cache"
        case .encryption: return "Encryption"
        case .notifications: return "Notifications"
        case .driveFolder: return "Drive Folder"
        case .done: return "Done"
        }
    }

    var isOptional: Bool {
        switch self {
        case .encryption, .notifications, .driveFolder:
            return true
        default:
            return false
        }
    }

    static func < (lhs: OnboardingStep, rhs: OnboardingStep) -> Bool {
        lhs.index < rhs.index
    }
}

enum OnboardingStateStore {
    static func load(cacheRoot: String) -> OnboardingState {
        let url = path(cacheRoot: cacheRoot)
        guard let data = try? Data(contentsOf: url) else {
            return OnboardingState()
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let state = try? decoder.decode(OnboardingState.self, from: data) else {
            return OnboardingState()
        }
        return state
    }

    static func save(_ state: OnboardingState, cacheRoot: String) {
        let url = path(cacheRoot: cacheRoot)
        let tmp = url.appendingPathExtension("tmp")
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(state) else { return }
        do {
            try data.write(to: tmp, options: .atomic)
            _ = try? FileManager.default.removeItem(at: url)
            try FileManager.default.moveItem(at: tmp, to: url)
        } catch {
            _ = try? FileManager.default.removeItem(at: tmp)
        }
    }

    static func reset(cacheRoot: String) {
        try? FileManager.default.removeItem(at: path(cacheRoot: cacheRoot))
    }

    static func path(cacheRoot: String) -> URL {
        URL(fileURLWithPath: cacheRoot).appendingPathComponent("onboarding.json")
    }
}

@MainActor
final class OnboardingViewModel: ObservableObject {
    @Published private(set) var state: OnboardingState
    @Published var currentStep: OnboardingStep
    @Published var stepError: String?

    private let initialCacheRoot: String
    private let onCacheRootChanged: (String) -> Void
    private let onFinished: () -> Void

    init(
        cacheRoot: String,
        onCacheRootChanged: @escaping (String) -> Void = { _ in },
        onFinished: @escaping () -> Void = {}
    ) {
        self.initialCacheRoot = cacheRoot
        self.onCacheRootChanged = onCacheRootChanged
        self.onFinished = onFinished
        let loaded = OnboardingStateStore.load(cacheRoot: cacheRoot)
        self.state = loaded
        self.currentStep = loaded.lastStep
    }

    var effectiveCacheRoot: String {
        state.cacheRootOverride ?? initialCacheRoot
    }

    func update(_ mutate: (inout OnboardingState) -> Void) {
        mutate(&state)
        state.lastStep = currentStep
        persist()
    }

    func canAdvance(from step: OnboardingStep) -> Bool {
        switch step {
        case .welcome:
            return state.welcomeAcknowledged
        case .oauthClient:
            return state.oauthClient != nil
        case .signIn:
            return state.signedInAccount != nil
        case .scope:
            return state.scopesAcknowledged
        case .cacheRoot:
            return stepError == nil
        case .encryption, .driveFolder:
            return stepError == nil
        case .notifications, .done:
            return true
        }
    }

    func advance() {
        guard canAdvance(from: currentStep) else { return }
        stepError = nil
        currentStep = OnboardingStep.allCases.first(where: { $0 > currentStep }) ?? .done
        update { _ in }
    }

    func back() {
        stepError = nil
        currentStep = OnboardingStep.allCases.last(where: { $0 < currentStep }) ?? .welcome
        update { _ in }
    }

    func finish() {
        currentStep = .done
        update { state in
            state.completedAt = Date()
            state.lastStep = .done
        }
        onFinished()
    }

    func setCacheRootOverride(_ path: String?) {
        update { state in
            state.cacheRootOverride = path
        }
        onCacheRootChanged(effectiveCacheRoot)
    }

    private func persist() {
        OnboardingStateStore.save(state, cacheRoot: effectiveCacheRoot)
        if effectiveCacheRoot != initialCacheRoot {
            OnboardingStateStore.save(state, cacheRoot: initialCacheRoot)
        }
    }
}
