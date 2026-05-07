import AppKit
import Foundation

enum MelonPanEditorMode: String, CaseIterable, Identifiable {
    case editing
    case suggesting
    case viewing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .editing: return "Editing"
        case .suggesting: return "Suggesting"
        case .viewing: return "Viewing"
        }
    }
}

enum MelonPanInspectorPane: String, CaseIterable, Identifiable {
    case document
    case outline
    case comments
    case segments
    case warnings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .document: return "Document"
        case .outline: return "Outline"
        case .comments: return "Comments"
        case .segments: return "Segments"
        case .warnings: return "Warnings"
        }
    }

    var systemImage: String {
        switch self {
        case .document: return "doc.text"
        case .outline: return "list.bullet.indent"
        case .comments: return "text.bubble"
        case .segments: return "rectangle.3.group"
        case .warnings: return "exclamationmark.triangle"
        }
    }
}

struct EditorChromeSnapshot: Equatable {
    var documentId: String = ""
    var title: String = "Untitled document"
    var isLoading = false
    var loadingDetail: String?
    var loadError: String?
    var hasPendingOps = false
    var isSaving = false
    var isOffline = false
    var vimEnabled = false
    var vimMode: MelonPanTextView.VimModeLabel = .off
    var vimCommandLine: String?
    var pinnedRevision: String?
    var editorMode: MelonPanEditorMode = .editing
    var statusMessage = "Rich Docs cache"
    var outlineCount = 0
    var commentCount = 0
    var unresolvedCommentCount = 0
    var segmentCount = 0
    var warningCount = 0
    var suggestionCount = 0
    var zoomPercent = 100

    var displayTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Untitled document"
            : title
    }

    var canSave: Bool {
        hasPendingOps && !isSaving && !isLoading && loadError == nil
    }

    var canRefresh: Bool {
        !isLoading
    }

    var canEdit: Bool {
        !isLoading && loadError == nil && editorMode != .viewing
    }

    var canShowOutline: Bool {
        outlineCount > 0
    }

    var statusText: String {
        if isLoading {
            return loadingDetail ?? "Opening..."
        }
        if let vimCommandLine, !vimCommandLine.isEmpty {
            return vimCommandLine
        }
        return statusMessage
    }

    var syncTitle: String {
        if isSaving { return "Saving" }
        if hasPendingOps { return "Queued" }
        if suggestionCount > 0 { return "Suggestions" }
        return "Saved"
    }

    var vimModeTitle: String {
        switch vimMode {
        case .normal: return "NORMAL"
        case .insert: return "INSERT"
        case .visual: return "VISUAL"
        case .commandLine: return "COMMAND"
        case .off: return "OFF"
        }
    }

    var statusSegments: [String] {
        var segments: [String] = [syncTitle]
        if isOffline {
            segments.append("Offline")
        }
        if vimEnabled {
            segments.append("Vim \(vimModeTitle)")
        }
        segments.append(editorMode.title)
        if suggestionCount > 0 {
            segments.append("\(suggestionCount) suggestion\(suggestionCount == 1 ? "" : "s")")
        }
        if let pinnedRevision, !pinnedRevision.isEmpty {
            segments.append("Read-only \(pinnedRevision)")
        }
        if warningCount > 0 {
            segments.append("\(warningCount) warning\(warningCount == 1 ? "" : "s")")
        }
        return segments
    }
}

@MainActor
final class EditorChromeModel: ObservableObject {
    @Published var inspectorPane: MelonPanInspectorPane?
    @Published var showsStatusBar: Bool {
        didSet {
            UserDefaults.standard.set(showsStatusBar, forKey: Self.statusBarDefaultsKey)
        }
    }

    var snapshot = EditorChromeSnapshot()

    var save: (() -> Void)?
    var refresh: (() -> Void)?
    var find: (() -> Void)?
    var focusEditor: (() -> Void)?
    var toggleVim: (() -> Void)?
    var selectMode: ((MelonPanEditorMode) -> Void)?
    var setZoom: ((Int) -> Void)?
    var showInspector: ((MelonPanInspectorPane?) -> Void)?

    private static let statusBarDefaultsKey = "melonpan.editor.showsStatusBar"

    init() {
        if UserDefaults.standard.object(forKey: Self.statusBarDefaultsKey) == nil {
            showsStatusBar = true
        } else {
            showsStatusBar = UserDefaults.standard.bool(forKey: Self.statusBarDefaultsKey)
        }
    }

    func selectInspector(_ pane: MelonPanInspectorPane?) {
        inspectorPane = pane
        showInspector?(pane)
    }

    func toggleInspector(_ pane: MelonPanInspectorPane) {
        selectInspector(inspectorPane == pane ? nil : pane)
    }

    func toggleStatusBar() {
        showsStatusBar.toggle()
    }
}
