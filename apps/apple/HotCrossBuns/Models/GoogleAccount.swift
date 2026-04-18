import Foundation

struct GoogleAccount: Identifiable, Hashable, Codable, Sendable {
    let id: String
    var email: String
    var displayName: String
    var grantedScopes: Set<String>

    static let preview = GoogleAccount(
        id: "preview-account",
        email: "personal@example.com",
        displayName: "Personal Workspace",
        grantedScopes: [GoogleScope.tasks, GoogleScope.calendar]
    )
}

enum GoogleScope {
    static let tasks = "https://www.googleapis.com/auth/tasks"
    static let calendar = "https://www.googleapis.com/auth/calendar"
}

enum AuthState: Equatable, Sendable {
    case signedOut
    case authenticating
    case signedIn(GoogleAccount)
    case failed(String)

    var title: String {
        switch self {
        case .signedOut:
            "Not connected"
        case .authenticating:
            "Connecting"
        case .signedIn(let account):
            account.email
        case .failed:
            "Connection failed"
        }
    }
}
