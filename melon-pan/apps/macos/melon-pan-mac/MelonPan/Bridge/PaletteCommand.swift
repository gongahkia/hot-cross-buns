import Foundation

enum PaletteCommand: String, CaseIterable, Identifiable {
    case openHome, openDrive, openGraph, openTemplates, openConflicts, openDiagnostics, openSettings
    case newLocalDraft, newFromTemplate, closeActiveTab
    case syncPush, syncPull, syncDrain
    case signIn, signOut
    case showShortcutsHelp, openCacheRootInFinder, refreshDriveTree

    static let allCases: [PaletteCommand] = [
        .openHome,
        .openDrive,
        .openGraph,
        .openConflicts,
        .openDiagnostics,
        .openSettings,
        .closeActiveTab,
        .syncPull,
        .signIn,
        .signOut,
        .showShortcutsHelp,
        .openCacheRootInFinder,
        .refreshDriveTree,
    ]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .openHome: return "Open Home"
        case .openDrive: return "Open Drive"
        case .openGraph: return "Open Graph"
        case .openTemplates: return "Open Templates"
        case .openConflicts: return "Open Conflicts"
        case .openDiagnostics: return "Open Diagnostics"
        case .openSettings: return "Open Settings"
        case .newLocalDraft: return "New Local Draft"
        case .newFromTemplate: return "New from Template…"
        case .closeActiveTab: return "Close Tab"
        case .syncPush: return "Push Document"
        case .syncPull: return "Pull Document"
        case .syncDrain: return "Drain Pending"
        case .signIn: return "Sign In with Google"
        case .signOut: return "Sign Out"
        case .showShortcutsHelp: return "Melon Pan Help"
        case .openCacheRootInFinder: return "Reveal Cache in Finder"
        case .refreshDriveTree: return "Refresh Drive Tree"
        }
    }

    var subtitle: String {
        switch self {
        case .openHome: return "Show the editor workspace and open tabs."
        case .openDrive: return "Browse cached Google Drive Docs."
        case .openGraph: return "Visualize cached document links."
        case .openTemplates: return "Browse local Markdown templates."
        case .openConflicts: return "Review pending mutations and revision conflicts."
        case .openDiagnostics: return "Inspect cache, runtime, and sync health."
        case .openSettings: return "Open Melon Pan preferences."
        case .newLocalDraft: return "Create a new local Markdown draft."
        case .newFromTemplate: return "Open templates to start a draft from one."
        case .closeActiveTab: return "Close the focused document tab."
        case .syncPush: return "Upload the active document to Google Docs."
        case .syncPull: return "Pull the latest active document from Google Docs."
        case .syncDrain: return "Drain queued pending mutations for the active document."
        case .signIn: return "Connect a Google account using the browser OAuth flow."
        case .signOut: return "Clear the active account for this app session."
        case .showShortcutsHelp: return "Open the searchable Help reference."
        case .openCacheRootInFinder: return "Reveal the local Melon Pan cache folder."
        case .refreshDriveTree: return "Refresh cached Drive folders and Docs."
        }
    }

    var systemImage: String {
        switch self {
        case .openHome: return "house"
        case .openDrive: return "externaldrive"
        case .openGraph: return "point.3.connected.trianglepath.dotted"
        case .openTemplates: return "doc.on.doc"
        case .openConflicts: return "exclamationmark.triangle"
        case .openDiagnostics: return "stethoscope"
        case .openSettings: return "gearshape"
        case .newLocalDraft: return "doc.badge.plus"
        case .newFromTemplate: return "doc.on.doc"
        case .closeActiveTab: return "xmark.circle"
        case .syncPush: return "arrow.up.circle"
        case .syncPull: return "arrow.down.circle"
        case .syncDrain: return "tray.and.arrow.up"
        case .signIn: return "person.crop.circle.badge.plus"
        case .signOut: return "person.crop.circle.badge.minus"
        case .showShortcutsHelp: return "questionmark.circle"
        case .openCacheRootInFinder: return "folder"
        case .refreshDriveTree: return "arrow.clockwise"
        }
    }

    var keywords: [String] {
        switch self {
        case .openHome: return ["editor", "workspace", "tabs"]
        case .openDrive: return ["google", "docs", "browser", "files"]
        case .openGraph: return ["links", "network", "backlinks", "documents"]
        case .openTemplates: return ["template", "markdown", "starter"]
        case .openConflicts: return ["sync", "pending", "revision", "mutations"]
        case .openDiagnostics: return ["health", "debug", "status", "runtime"]
        case .openSettings: return ["preferences", "options"]
        case .newLocalDraft: return ["new", "document", "markdown", "draft"]
        case .newFromTemplate: return ["new", "template", "markdown", "draft"]
        case .closeActiveTab: return ["close", "document", "tab"]
        case .syncPush: return ["sync", "upload", "save"]
        case .syncPull: return ["sync", "download", "refresh"]
        case .syncDrain: return ["sync", "queue", "pending"]
        case .signIn: return ["login", "google", "oauth", "account"]
        case .signOut: return ["logout", "google", "account"]
        case .showShortcutsHelp: return ["help", "keys", "commands"]
        case .openCacheRootInFinder: return ["cache", "finder", "folder", "reveal"]
        case .refreshDriveTree: return ["drive", "reload", "sync", "files"]
        }
    }

    var shortcut: String {
        switch self {
        case .openHome: return "⌘1"
        case .openDrive: return "⌘2"
        case .openGraph: return "⌘3"
        case .openTemplates: return "⌘4"
        case .openConflicts: return "⌘5"
        case .openDiagnostics: return "⌘6"
        case .openSettings: return "⌘,"
        case .newLocalDraft: return "⌘N"
        case .newFromTemplate: return "⌥⌘N"
        case .closeActiveTab: return "⌘W"
        case .showShortcutsHelp: return "⌘?"
        default: return ""
        }
    }
}

enum PaletteItem: Identifiable {
    case command(PaletteCommand)
    case document(DriveItem)

    var id: String {
        switch self {
        case .command(let command): return "cmd-\(command.id)"
        case .document(let document): return "doc-\(document.id)"
        }
    }

    var label: String {
        switch self {
        case .command(let command): return command.title
        case .document(let document): return document.name
        }
    }

    var keywords: [String] {
        switch self {
        case .command(let command): return [command.subtitle] + command.keywords
        case .document(let document): return [document.mimeType]
        }
    }

    var systemImage: String {
        switch self {
        case .command(let command): return command.systemImage
        case .document: return "doc.text"
        }
    }

    var subtitle: String {
        switch self {
        case .command(let command): return command.subtitle
        case .document(let document): return "Google Doc • \(document.id)"
        }
    }

    var shortcut: String {
        switch self {
        case .command(let command): return command.shortcut
        case .document: return ""
        }
    }
}
