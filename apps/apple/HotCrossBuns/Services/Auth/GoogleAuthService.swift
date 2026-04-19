import AppKit
import Foundation
import GoogleSignIn
import Observation

@MainActor
@Observable
final class GoogleAuthService {
    private let bundle: Bundle
    private let requiredScopes = [GoogleScope.tasks, GoogleScope.calendar]

    init(bundle: Bundle = .main) {
        self.bundle = bundle
    }

    var isConfigured: Bool {
        guard let clientID, clientID.isEmpty == false, clientID.hasPrefix("$(") == false else {
            return false
        }
        return true
    }

    func restorePreviousSignIn() async throws -> GoogleAccount? {
        guard isConfigured else {
            AppLogger.warn("restore skipped: OAuth not configured", category: .auth)
            return nil
        }

        guard GIDSignIn.sharedInstance.hasPreviousSignIn() else {
            AppLogger.info("restore: no previous session", category: .auth)
            return nil
        }

        do {
            let user = try await GIDSignIn.sharedInstance.restorePreviousSignIn()
            let missingScopes = requiredScopes.filter { scope in
                user.grantedScopes?.contains(scope) != true
            }
            guard missingScopes.isEmpty else {
                AppLogger.warn("restore: scopes revoked, forcing sign-out", category: .auth, metadata: ["missing": missingScopes.count.description])
                GIDSignIn.sharedInstance.signOut()
                return nil
            }
            let acc = try account(from: user)
            AppLogger.info("restore: success", category: .auth, metadata: ["email": Self.redact(acc.email)])
            return acc
        } catch {
            AppLogger.error("restore failed", category: .auth, metadata: ["error": String(describing: error)])
            throw error
        }
    }

    private static func redact(_ email: String) -> String {
        guard let at = email.firstIndex(of: "@") else { return "<redacted>" }
        let local = email[..<at]
        let domain = email[email.index(after: at)...]
        let prefix = local.prefix(2)
        return "\(prefix)***@\(domain)"
    }

    func signIn() async throws -> GoogleAccount {
        guard isConfigured else {
            AppLogger.error("signIn: OAuth not configured", category: .auth)
            throw GoogleAuthError.notConfigured
        }

        if let currentUser = GIDSignIn.sharedInstance.currentUser {
            AppLogger.info("signIn: reusing current user", category: .auth)
            return try await accountWithRequiredScopes(for: currentUser)
        }

        AppLogger.info("signIn: presenting Google sheet", category: .auth)
        let anchor = try currentPresentationAnchor()
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: anchor,
                hint: nil,
                additionalScopes: requiredScopes
            )
            let acc = try account(from: result.user)
            AppLogger.info("signIn: success", category: .auth, metadata: ["email": Self.redact(acc.email)])
            return acc
        } catch {
            AppLogger.error("signIn failed", category: .auth, metadata: ["error": String(describing: error)])
            throw error
        }
    }

    func signOut() {
        GIDSignIn.sharedInstance.signOut()
    }

    func disconnect() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            GIDSignIn.sharedInstance.disconnect { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    func handleRedirectURL(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    private var clientID: String? {
        bundle.object(forInfoDictionaryKey: "GIDClientID") as? String
    }

    private func accountWithRequiredScopes(for user: GIDGoogleUser) async throws -> GoogleAccount {
        let missingScopes = requiredScopes.filter { scope in
            user.grantedScopes?.contains(scope) != true
        }

        guard missingScopes.isEmpty == false else {
            return try account(from: user)
        }

        let result = try await addScopes(missingScopes, to: user)
        return try account(from: result.user)
    }

    private func addScopes(_ scopes: [String], to user: GIDGoogleUser) async throws -> GIDSignInResult {
        let anchor = try currentPresentationAnchor()
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<GIDSignInResult, Error>) in
            user.addScopes(scopes, presenting: anchor) { result, error in
                if let result {
                    continuation.resume(returning: result)
                } else {
                    continuation.resume(throwing: error ?? GoogleAuthError.emptySignInResult)
                }
            }
        }
    }

    private func account(from user: GIDGoogleUser) throws -> GoogleAccount {
        guard let email = user.profile?.email, email.isEmpty == false else {
            throw GoogleAuthError.missingProfile
        }

        return GoogleAccount(
            id: user.userID ?? email,
            email: email,
            displayName: user.profile?.name ?? email,
            grantedScopes: Set(user.grantedScopes ?? [])
        )
    }

    private func currentPresentationAnchor() throws -> NSWindow {
        if let keyWindow = NSApplication.shared.keyWindow {
            return keyWindow
        }

        if let mainWindow = NSApplication.shared.mainWindow {
            return mainWindow
        }

        if let visibleWindow = NSApplication.shared.windows.first(where: { $0.isVisible }) {
            return visibleWindow
        }

        throw GoogleAuthError.noPresentationAnchor
    }
}

enum GoogleAuthError: LocalizedError, Equatable {
    case notConfigured
    case noPresentationAnchor
    case noCurrentUser
    case missingProfile
    case emptySignInResult

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "Google OAuth client IDs are not configured yet."
        case .noPresentationAnchor:
            "No active app window is available to present Google Sign-In."
        case .noCurrentUser:
            "No Google account is currently signed in."
        case .missingProfile:
            "Google Sign-In did not return an email address for this account."
        case .emptySignInResult:
            "Google Sign-In finished without returning an account."
        }
    }
}

enum GoogleTokenRefreshError: LocalizedError {
    case noCurrentUser
    case refreshFailed(Error)

    var errorDescription: String? {
        switch self {
        case .noCurrentUser:
            "Not signed in to Google. Reconnect to continue syncing."
        case .refreshFailed(let underlying):
            "Google sign-in session expired: \(underlying.localizedDescription). Reconnect to continue."
        }
    }

    // Token refresh failures mean the user needs to re-authenticate — surface
    // to the reconnect CTA rather than the generic sync banner.
    var requiresReconnect: Bool {
        true
    }
}

struct GoogleSignInAccessTokenProvider: AccessTokenProviding {
    @MainActor
    func accessToken() async throws -> String {
        guard let user = GIDSignIn.sharedInstance.currentUser else {
            AppLogger.warn("accessToken: no current user", category: .auth)
            throw GoogleTokenRefreshError.noCurrentUser
        }

        do {
            let refreshedUser = try await user.refreshTokensIfNeeded()
            return refreshedUser.accessToken.tokenString
        } catch {
            AppLogger.error("token refresh failed", category: .auth, metadata: ["error": String(describing: error)])
            throw GoogleTokenRefreshError.refreshFailed(error)
        }
    }
}
