import Foundation
import Observation

@MainActor
@Observable
final class GoogleAuthService {
    private var configuredClientID: String?

    init(configuredClientID: String? = nil) {
        self.configuredClientID = configuredClientID
    }

    func signIn() async throws -> GoogleAccount {
        guard configuredClientID?.isEmpty == false else {
            throw GoogleAuthError.notConfigured
        }

        throw GoogleAuthError.nativeSDKNotInstalled
    }
}

enum GoogleAuthError: LocalizedError, Equatable {
    case notConfigured
    case nativeSDKNotInstalled

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "Google OAuth client IDs are not configured yet."
        case .nativeSDKNotInstalled:
            "Google Sign-In SDK integration has not been wired into this target yet."
        }
    }
}
