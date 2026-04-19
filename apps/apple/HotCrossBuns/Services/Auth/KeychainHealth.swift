import Foundation
import Security

// Minimal probe so we can detect at launch whether the user's
// Keychain is readable. If it's locked (the Keychain prompts for a
// password and the user dismissed without unlocking) or wiped
// (password reset cleared the login keychain), GIDSignIn.restore
// surfaces a generic error and the user sees "reconnect" with no
// hint that Keychain access is the culprit. Logging the probe result
// at startup lets DiagnosticsView tell them exactly what's wrong.
enum KeychainHealth: String, Sendable {
    case ok
    case denied
    case unknown

    var displayTitle: String {
        switch self {
        case .ok: "Accessible"
        case .denied: "Access denied"
        case .unknown: "Unknown"
        }
    }
}

enum KeychainProbe {
    // A non-destructive read against a benign service name. errSecItemNotFound
    // is the expected good case (no probe item exists yet, which means the
    // Keychain is readable and simply has no match). Anything else — locked,
    // no-access, corrupt — is treated as denied.
    @discardableResult
    static func run() -> KeychainHealth {
        let tag = "com.gongahkia.hotcrossbuns.keychain-probe"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: tag,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: false
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        let health: KeychainHealth
        switch status {
        case errSecSuccess, errSecItemNotFound:
            health = .ok
        case errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable:
            health = .denied
        default:
            // Unexpected OSStatus. Classify as unknown so the UI can say
            // "we saw something unusual; sign in to verify" rather than
            // hard-failing.
            health = status == 0 ? .ok : .unknown
        }
        AppLogger.info("keychain probe", category: .auth, metadata: [
            "status": String(status),
            "health": health.rawValue
        ])
        return health
    }
}
