// Persists the open-tab list to <config>/windows.json so the
// shell can rehydrate tabs across launches.
//
// Storage layout:
//   ~/Library/Application Support/MelonPan/windows.json
//   {
//     "openDocuments": ["doc-id-1", "doc-id-2", ...],
//     "activeDocumentId": "doc-id-2"
//   }
//
// The active id is the Drive document_id (not the SwiftUI UUID)
// since UUIDs reset on every launch — the tab whose Drive id matches
// the persisted activeDocumentId becomes selected on restore.

import Foundation

public struct WindowsState: Codable {
    public var openDocuments: [String]
    public var activeDocumentId: String?

    public static let empty = WindowsState(
        openDocuments: [],
        activeDocumentId: nil
    )
}

public enum WindowsStateStore {
    /// Path to windows.json beside credentials.json.
    private static func path() -> URL {
        let credentials = RuntimeBridge.defaultCredentialsPath()
        let parent = URL(fileURLWithPath: credentials)
            .deletingLastPathComponent()
        return parent.appendingPathComponent("windows.json")
    }

    public static func load() -> WindowsState {
        let url = path()
        guard let data = try? Data(contentsOf: url) else {
            return .empty
        }
        return (try? JSONDecoder().decode(WindowsState.self, from: data))
            ?? .empty
    }

    public static func save(_ state: WindowsState) {
        let url = path()
        let parent = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(
            at: parent,
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(state) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
