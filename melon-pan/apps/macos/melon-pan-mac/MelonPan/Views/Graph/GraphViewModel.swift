import Foundation

struct GraphNode: Identifiable, Hashable {
    let id: String
    var title: String
    var isCached: Bool
    var isDriveDocument: Bool
    var folderIds: Set<String>
    var outgoingCount: Int
    var incomingCount: Int
}

struct GraphFolder: Identifiable, Hashable {
    let id: String
    var name: String
    var path: String
    var documentCount: Int
}

struct GraphEdge: Identifiable, Hashable {
    let source: String
    let target: String

    var id: String { "\(source)->\(target)" }
}

@MainActor
final class GraphViewModel: ObservableObject {
    static let rootFolderId = "__melon_pan_drive_root__"

    @Published var nodes: [GraphNode] = []
    @Published var edges: [GraphEdge] = []
    @Published var folders: [GraphFolder] = []
    @Published var selectedNodeId: String?
    @Published var query = ""
    @Published var hiddenDocumentIds = Set<String>()
    @Published var hiddenFolderIds = Set<String>()
    @Published var showExternalLinkedDocs = true
    @Published var isLoading = false
    @Published var lastError: String?

    var filteredNodes: [GraphNode] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = nodes.filter { node in
            guard !hiddenDocumentIds.contains(node.id) else { return false }
            guard node.isDriveDocument || showExternalLinkedDocs else { return false }
            return node.folderIds.isDisjoint(with: hiddenFolderIds)
        }
        guard !trimmed.isEmpty else { return base }
        let needle = trimmed.lowercased()
        return base.filter {
            $0.title.lowercased().contains(needle) ||
                $0.id.lowercased().contains(needle)
        }
    }

    var driveDocumentNodes: [GraphNode] {
        nodes.filter(\.isDriveDocument)
    }

    var filteredNodeIds: Set<String> {
        Set(filteredNodes.map(\.id))
    }

    var filteredEdges: [GraphEdge] {
        let ids = filteredNodeIds
        guard !ids.isEmpty else { return [] }
        return edges.filter { ids.contains($0.source) && ids.contains($0.target) }
    }

    var selectedNode: GraphNode? {
        guard let selectedNodeId else { return nil }
        return nodes.first { $0.id == selectedNodeId }
    }

    func reload(cacheRoot: String) async {
        guard !cacheRoot.isEmpty else {
            nodes = []
            edges = []
            folders = []
            selectedNodeId = nil
            lastError = "Cache is not initialized."
            return
        }

        isLoading = true
        lastError = nil
        defer { isLoading = false }

        do {
            let cachedIds = try RuntimeBridge.listCachedDocumentIds(cacheRoot: cacheRoot)
            let cachedSet = Set(cachedIds)
            let driveTree = DriveTree.load(from: cacheRoot)
            let driveItems = driveTree.files
            let driveDocuments = driveItems.filter { $0.isDocument && !$0.trashed }
            let driveDocumentIds = Set(driveDocuments.map(\.id))
            let driveNames = driveDocuments.reduce(into: [String: String]()) { result, item in
                guard item.isDocument else { return }
                result[item.id] = item.name
            }
            let folderIdsByDocument = Self.folderIdsByDocument(from: driveItems)
            let folderList = Self.folderList(from: driveItems, folderIdsByDocument: folderIdsByDocument)

            var titles: [String: String] = driveNames
            var edgeSet = Set<GraphEdge>()
            var discoveredIds = driveDocumentIds

            for documentId in cachedIds {
                guard let json = try RuntimeBridge.loadRichDocumentForSwift(
                    cacheRoot: cacheRoot,
                    documentId: documentId
                ) else {
                    continue
                }
                let model = try JSONDecoder().decode(RichDocumentModel.self, from: Data(json.utf8))
                titles[documentId] = model.title.isEmpty ? titles[documentId] ?? documentId : model.title

                for targetId in Self.linkedDocumentIds(in: model) where targetId != documentId {
                    discoveredIds.insert(targetId)
                    edgeSet.insert(GraphEdge(source: documentId, target: targetId))
                }
            }

            let edgeList = edgeSet.sorted {
                if $0.source == $1.source { return $0.target < $1.target }
                return $0.source < $1.source
            }
            let nodeList = discoveredIds.map { id in
                GraphNode(
                    id: id,
                    title: titles[id] ?? shortDocumentId(id),
                    isCached: cachedSet.contains(id),
                    isDriveDocument: driveDocumentIds.contains(id),
                    folderIds: folderIdsByDocument[id] ?? [],
                    outgoingCount: edgeList.filter { $0.source == id }.count,
                    incomingCount: edgeList.filter { $0.target == id }.count
                )
            }
            .sorted {
                if $0.isDriveDocument != $1.isDriveDocument { return $0.isDriveDocument }
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }

            nodes = nodeList
            edges = edgeList
            folders = folderList
            hiddenDocumentIds.formIntersection(Set(nodeList.map(\.id)))
            hiddenFolderIds.formIntersection(Set(folderList.map(\.id)))
            if let selectedNodeId, nodeList.contains(where: { $0.id == selectedNodeId }) {
                self.selectedNodeId = selectedNodeId
            } else {
                selectedNodeId = nodeList.first?.id
            }
        } catch {
            lastError = "\(error)"
            nodes = []
            edges = []
            folders = []
            selectedNodeId = nil
        }
    }

    func setDocument(_ id: String, visible: Bool) {
        if visible {
            hiddenDocumentIds.remove(id)
        } else {
            hiddenDocumentIds.insert(id)
            if selectedNodeId == id {
                selectedNodeId = filteredNodes.first?.id
            }
        }
    }

    func setFolder(_ id: String, visible: Bool) {
        if visible {
            hiddenFolderIds.remove(id)
        } else {
            hiddenFolderIds.insert(id)
            if let selectedNode = selectedNode,
               !selectedNode.folderIds.isDisjoint(with: hiddenFolderIds) {
                selectedNodeId = filteredNodes.first?.id
            }
        }
    }

    func showAllFilters() {
        hiddenDocumentIds.removeAll()
        hiddenFolderIds.removeAll()
        showExternalLinkedDocs = true
    }

    func hideAllDriveDocuments() {
        hiddenDocumentIds = Set(driveDocumentNodes.map(\.id))
    }

    private static func linkedDocumentIds(in document: RichDocumentModel) -> Set<String> {
        var result = Set<String>()
        for tab in document.tabs {
            collectLinks(from: tab, into: &result)
        }
        return result
    }

    private static func collectLinks(from tab: RichDocumentModel.Tab, into result: inout Set<String>) {
        if let blocks = tab.blocks {
            for block in blocks {
                collectLinks(from: block, into: &result)
            }
        } else {
            for paragraph in tab.paragraphs {
                collectLinks(from: paragraph, into: &result)
            }
            if let tables = tab.tables {
                for table in tables {
                    collectLinks(from: table, into: &result)
                }
            }
        }
        for child in tab.childTabs {
            collectLinks(from: child, into: &result)
        }
    }

    private static func collectLinks(from block: RichDocumentModel.Block, into result: inout Set<String>) {
        if let paragraph = block.paragraph {
            collectLinks(from: paragraph, into: &result)
        }
        if let table = block.table {
            collectLinks(from: table, into: &result)
        }
    }

    private static func collectLinks(from table: RichDocumentModel.Table, into result: inout Set<String>) {
        for row in table.rows {
            for cell in row.cells {
                for block in cell.blocks {
                    collectLinks(from: block, into: &result)
                }
            }
        }
    }

    private static func collectLinks(from paragraph: RichDocumentModel.Paragraph, into result: inout Set<String>) {
        for run in paragraph.runs {
            guard let url = run.linkUrl,
                  let documentId = documentId(from: url)
            else {
                continue
            }
            result.insert(documentId)
        }
    }

    private static func documentId(from value: String) -> String? {
        guard let url = URL(string: value),
              url.host?.contains("docs.google.com") == true
        else {
            return nil
        }
        let parts = url.pathComponents.filter { $0 != "/" }
        if let index = parts.firstIndex(of: "d"),
           parts.indices.contains(index + 1) {
            return parts[index + 1]
        }
        return nil
    }

    private static func folderIdsByDocument(from items: [DriveItem]) -> [String: Set<String>] {
        let folderIds = Set(items.filter(\.isFolder).map(\.id))
        let parentFoldersById = Dictionary(uniqueKeysWithValues: items.map { item in
            (item.id, item.parents.filter { folderIds.contains($0) })
        })

        return items.filter { $0.isDocument && !$0.trashed }.reduce(into: [String: Set<String>]()) { result, item in
            var collected = Set<String>()
            var stack = item.parents.filter { folderIds.contains($0) }
            var seen = Set<String>()
            while let id = stack.popLast() {
                guard !seen.contains(id) else { continue }
                seen.insert(id)
                collected.insert(id)
                stack.append(contentsOf: parentFoldersById[id] ?? [])
            }
            if collected.isEmpty {
                collected.insert(rootFolderId)
            }
            result[item.id] = collected
        }
    }

    private static func folderList(
        from items: [DriveItem],
        folderIdsByDocument: [String: Set<String>]
    ) -> [GraphFolder] {
        let itemsById = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
        let counts = folderIdsByDocument.values.reduce(into: [String: Int]()) { result, ids in
            for id in ids {
                result[id, default: 0] += 1
            }
        }
        var folders = items.filter { $0.isFolder && !$0.trashed }.map { item in
            GraphFolder(
                id: item.id,
                name: item.name,
                path: folderPath(for: item.id, itemsById: itemsById),
                documentCount: counts[item.id, default: 0]
            )
        }
        if let rootCount = counts[rootFolderId], rootCount > 0 {
            folders.append(GraphFolder(
                id: rootFolderId,
                name: "Drive root",
                path: "Drive root",
                documentCount: rootCount
            ))
        }
        return folders
            .filter { $0.documentCount > 0 }
            .sorted {
                $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending
            }
    }

    private static func folderPath(for folderId: String, itemsById: [String: DriveItem]) -> String {
        var parts: [String] = []
        var currentId: String? = folderId
        var seen = Set<String>()
        while let id = currentId,
              !seen.contains(id),
              let item = itemsById[id] {
            seen.insert(id)
            parts.append(item.name)
            currentId = item.parents.first { itemsById[$0]?.isFolder == true }
        }
        return parts.reversed().joined(separator: " / ")
    }
}
