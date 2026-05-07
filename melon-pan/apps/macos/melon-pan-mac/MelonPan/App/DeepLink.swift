import Foundation

enum DeepLink: Equatable, Sendable {
    case openDocument(id: String, revision: String?)
    case openDrive(folderId: String?)
    case switchPane(AppSession.Pane)
    case openPalette(query: String?)
    case runCommand(id: String)
    case newDraft(title: String?, body: String?)
    case openHistory
    case openSettings(section: String?)
    case openOnboarding
    case openApp
}

struct DeepLinkError: Error, Equatable, Sendable {
    let message: String
}
