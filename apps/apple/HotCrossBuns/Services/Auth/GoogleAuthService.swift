import Foundation
import GoogleSignIn
import Observation

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

@MainActor
@Observable
final class GoogleAuthService {
    private let bundle: Bundle
    private var didConfigureSDK = false
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
            return nil
        }

        try await configureSDKIfNeeded()

        guard GIDSignIn.sharedInstance.hasPreviousSignIn() else {
            return nil
        }

        let user = try await GIDSignIn.sharedInstance.restorePreviousSignIn()
        return try account(from: user)
    }

    func signIn() async throws -> GoogleAccount {
        guard isConfigured else {
            throw GoogleAuthError.notConfigured
        }

        try await configureSDKIfNeeded()

        if let currentUser = GIDSignIn.sharedInstance.currentUser {
            return try await accountWithRequiredScopes(for: currentUser)
        }

        #if os(iOS)
        let result = try await GIDSignIn.sharedInstance.signIn(
            withPresenting: currentPresentationAnchor(),
            hint: nil,
            additionalScopes: requiredScopes
        )
        #elseif os(macOS)
        let result = try await GIDSignIn.sharedInstance.signIn(
            withPresenting: currentPresentationAnchor(),
            hint: nil,
            additionalScopes: requiredScopes
        )
        #else
        throw GoogleAuthError.unsupportedPlatform
        #endif

        return try account(from: result.user)
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

    private func configureSDKIfNeeded() async throws {
        guard didConfigureSDK == false else {
            return
        }

        #if os(iOS)
        try await withCheckedThrowingContinuation { continuation in
            GIDSignIn.sharedInstance.configure { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
        #endif

        didConfigureSDK = true
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
        #if os(iOS) || os(macOS)
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
        #else
        throw GoogleAuthError.unsupportedPlatform
        #endif
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
}

enum GoogleAuthError: LocalizedError, Equatable {
    case notConfigured
    case noPresentationAnchor
    case noCurrentUser
    case missingProfile
    case emptySignInResult
    case unsupportedPlatform

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
        case .unsupportedPlatform:
            "Google Sign-In is only supported on iOS, iPadOS, and macOS for this app."
        }
    }
}

struct GoogleSignInAccessTokenProvider: AccessTokenProviding {
    @MainActor
    func accessToken() async throws -> String {
        guard let user = GIDSignIn.sharedInstance.currentUser else {
            throw GoogleAuthError.noCurrentUser
        }

        let refreshedUser = try await user.refreshTokensIfNeeded()
        return refreshedUser.accessToken.tokenString
    }
}

#if os(iOS)
private extension GoogleAuthService {
    func currentPresentationAnchor() throws -> UIViewController {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let keyWindow = scenes
            .flatMap(\.windows)
            .first { $0.isKeyWindow }

        guard let root = keyWindow?.rootViewController ?? scenes.flatMap(\.windows).first?.rootViewController else {
            throw GoogleAuthError.noPresentationAnchor
        }

        return root.topmostPresentedViewController
    }
}

private extension UIViewController {
    var topmostPresentedViewController: UIViewController {
        if let presentedViewController {
            return presentedViewController.topmostPresentedViewController
        }

        if let navigationController = self as? UINavigationController,
           let visibleViewController = navigationController.visibleViewController {
            return visibleViewController.topmostPresentedViewController
        }

        if let tabBarController = self as? UITabBarController,
           let selectedViewController = tabBarController.selectedViewController {
            return selectedViewController.topmostPresentedViewController
        }

        return self
    }
}
#elseif os(macOS)
private extension GoogleAuthService {
    func currentPresentationAnchor() throws -> NSWindow {
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
#endif
