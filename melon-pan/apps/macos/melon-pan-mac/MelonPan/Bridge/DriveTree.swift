// Codable model for `<cache>/drive-tree.json`. The macOS shell reads it
// directly to populate the sidebar; no FFI roundtrip is needed because
// the schema is pinned by tests/cross-platform-cache/melon-pan/drive-tree.json.

import Foundation

public struct DriveTree: Codable {
    public let files: [DriveItem]

    public static let empty = DriveTree(files: [])

    /// Reads + parses `<cacheRoot>/drive-tree.json`. Returns `.empty`
    /// when the file is missing or unparseable so the sidebar always
    /// has something to render.
    public static func load(from cacheRoot: String) -> DriveTree {
        let url = URL(fileURLWithPath: cacheRoot)
            .appendingPathComponent("drive-tree.json")
        guard let data = try? Data(contentsOf: url) else { return .empty }
        return (try? JSONDecoder().decode(DriveTree.self, from: data)) ?? .empty
    }
}

public struct DriveItem: Codable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let mimeType: String
    public let parents: [String]
    public let trashed: Bool
    public let modifiedTime: String?

    public var isFolder: Bool {
        mimeType == "application/vnd.google-apps.folder"
    }

    public var isDocument: Bool {
        mimeType == "application/vnd.google-apps.document"
    }

    public var fileKind: DriveFileKind {
        DriveFileKind(item: self)
    }

    /// Symbol name for the SwiftUI Label in DrivePane. Greys out
    /// non-Doc files visually by picking a different system icon.
    public var systemImage: String {
        if trashed { return "trash" }
        if isFolder { return "folder" }
        if isDocument { return "doc.text" }
        return "doc"
    }
}

public enum DriveFileKind: String, CaseIterable, Identifiable {
    case googleDoc
    case googleSheet
    case googleSlide
    case pdf
    case image
    case video
    case audio
    case text
    case other

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .googleDoc: return "Google Docs"
        case .googleSheet: return "Google Sheets"
        case .googleSlide: return "Google Slides"
        case .pdf: return "PDFs"
        case .image: return "Images"
        case .video: return "Videos"
        case .audio: return "Audio"
        case .text: return "Text files"
        case .other: return "Other files"
        }
    }

    public var detail: String {
        switch self {
        case .googleDoc: return "Editable in Melon Pan"
        case .googleSheet: return "Visible only"
        case .googleSlide: return "Visible only"
        case .pdf: return "Visible only"
        case .image: return "Visible only"
        case .video: return "Visible only"
        case .audio: return "Visible only"
        case .text: return "Visible only"
        case .other: return "Visible only"
        }
    }

    public init(item: DriveItem) {
        let mime = item.mimeType
        let name = item.name.lowercased()
        if mime == "application/vnd.google-apps.document" {
            self = .googleDoc
        } else if mime == "application/vnd.google-apps.spreadsheet" {
            self = .googleSheet
        } else if mime == "application/vnd.google-apps.presentation" {
            self = .googleSlide
        } else if mime == "application/pdf" || name.hasSuffix(".pdf") {
            self = .pdf
        } else if mime.hasPrefix("image/") {
            self = .image
        } else if mime.hasPrefix("video/") {
            self = .video
        } else if mime.hasPrefix("audio/") {
            self = .audio
        } else if mime.hasPrefix("text/") ||
                    mime == "application/rtf" ||
                    mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                    name.hasSuffix(".txt") ||
                    name.hasSuffix(".md") ||
                    name.hasSuffix(".rtf") ||
                    name.hasSuffix(".docx") {
            self = .text
        } else {
            self = .other
        }
    }
}

/// One node in the hierarchical Drive tree. Wraps a `DriveItem` with
/// its eagerly-resolved children so SwiftUI's `OutlineGroup(_:children:)`
/// can take a key-path rather than a closure (the API requires the
/// children parameter to be a literal KeyPath, not a function).
public struct DriveNode: Identifiable, Hashable {
    public let id: String
    public let item: DriveItem
    /// nil for non-folders so OutlineGroup hides the disclosure
    /// triangle. Empty array (folder with no children) keeps the
    /// triangle visible but expands to nothing.
    public let children: [DriveNode]?
}

/// Builds the hierarchical view of a flat DriveTree. Folders sort
/// before docs; alphabetical within each group.
public enum DriveTreeIndex {
    public static func build(from tree: DriveTree) -> [DriveNode] {
        let itemIDs = Set(tree.files.map(\.id))
        var byParent: [String: [DriveItem]] = [:]
        var roots: [DriveItem] = []
        for item in tree.files {
            let parentIDs = item.parents.filter { $0 != "root" && itemIDs.contains($0) }
            if parentIDs.isEmpty {
                roots.append(item)
            } else {
                for parent in parentIDs {
                    byParent[parent, default: []].append(item)
                }
            }
        }
        let sortKey: (DriveItem, DriveItem) -> Bool = { lhs, rhs in
            if lhs.isFolder != rhs.isFolder { return lhs.isFolder }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name)
                == .orderedAscending
        }
        roots.sort(by: sortKey)
        for key in byParent.keys {
            byParent[key]?.sort(by: sortKey)
        }
        return roots.map { node(for: $0, byParent: byParent) }
    }

    private static func node(
        for item: DriveItem,
        byParent: [String: [DriveItem]]
    ) -> DriveNode {
        if item.isFolder {
            let kids = (byParent[item.id] ?? [])
                .map { node(for: $0, byParent: byParent) }
            return DriveNode(id: item.id, item: item, children: kids)
        }
        return DriveNode(id: item.id, item: item, children: nil)
    }
}
