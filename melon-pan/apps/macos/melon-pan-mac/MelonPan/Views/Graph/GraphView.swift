import SwiftUI

struct GraphView: View {
    @EnvironmentObject private var session: AppSession
    @StateObject private var model = GraphViewModel()

    var body: some View {
        NavigationSplitView {
            graphSidebar
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
        } detail: {
            graphCanvas
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .task { await model.reload(cacheRoot: session.cacheRoot) }
    }

    private var graphSidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search graph", text: $model.query)
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))

                Button {
                    Task { await model.reload(cacheRoot: session.cacheRoot) }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .labelStyle(.iconOnly)
                .help("Refresh graph")
            }
            .padding(12)

            Divider()

            graphFilters

            Divider()

            if model.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.filteredNodes.isEmpty {
                GraphPlaceholder(
                    title: model.nodes.isEmpty ? "No Drive documents" : "No matches",
                    systemImage: "point.3.connected.trianglepath.dotted",
                    message: model.nodes.isEmpty ? "Refresh Drive to load documents. Cached documents contribute link and backlink edges." : nil
                )
            } else {
                List(selection: $model.selectedNodeId) {
                    ForEach(model.filteredNodes) { node in
                        GraphNodeRow(node: node)
                            .tag(String?.some(node.id))
                    }
                }
                .listStyle(.sidebar)
            }

            if let error = model.lastError {
                Divider()
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
                    .padding(10)
            }
        }
        .navigationTitle("Graph")
    }

    private var graphFilters: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Button("Show All") {
                        model.showAllFilters()
                    }
                    Button("Hide Docs") {
                        model.hideAllDriveDocuments()
                    }
                }
                .buttonStyle(.borderless)

                Toggle("Linked docs outside Drive tree", isOn: $model.showExternalLinkedDocs)

                if !model.folders.isEmpty {
                    DisclosureGroup("Folders") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(model.folders) { folder in
                                Toggle(isOn: folderVisibilityBinding(folder.id)) {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(folder.name)
                                            .lineLimit(1)
                                        Text("\(folder.documentCount) docs")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    .help(folder.path)
                                }
                            }
                        }
                        .padding(.leading, 4)
                    }
                }

                if !model.driveDocumentNodes.isEmpty {
                    DisclosureGroup("Documents") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(model.driveDocumentNodes) { node in
                                Toggle(isOn: documentVisibilityBinding(node.id)) {
                                    Text(node.title)
                                        .lineLimit(1)
                                }
                            }
                        }
                        .padding(.leading, 4)
                    }
                }
            }
            .font(.caption)
            .padding(.top, 6)
        } label: {
            Label("Filters", systemImage: "line.3.horizontal.decrease.circle")
                .font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var graphCanvas: some View {
        GraphCanvas(
            nodes: model.filteredNodes,
            edges: model.filteredEdges,
            selectedNodeId: $model.selectedNodeId
        ) { node in
            if node.isCached {
                session.openDocumentById(node.id)
            } else {
                session.beginDocumentFetch(id: node.id, title: node.title, revision: nil)
            }
        }
        .overlay(alignment: .bottomLeading) {
            graphSummary
                .padding(12)
        }
    }

    private var graphSummary: some View {
        HStack(spacing: 14) {
            Label("\(model.filteredNodes.count) docs", systemImage: "doc.text")
            Label("\(model.filteredEdges.count) links", systemImage: "arrow.right")
            Label("\(model.nodes.count - model.filteredNodes.count) hidden", systemImage: "eye.slash")
            if let selected = model.selectedNode {
                Divider()
                    .frame(height: 16)
                Text(selected.title)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
    }

    private func documentVisibilityBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { !model.hiddenDocumentIds.contains(id) },
            set: { model.setDocument(id, visible: $0) }
        )
    }

    private func folderVisibilityBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { !model.hiddenFolderIds.contains(id) },
            set: { model.setFolder(id, visible: $0) }
        )
    }
}

private struct GraphNodeRow: View {
    let node: GraphNode

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .foregroundStyle(node.isDriveDocument ? .secondary : .tertiary)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(node.title)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var iconName: String {
        if !node.isDriveDocument { return "link" }
        return node.isCached ? "doc.text" : "doc"
    }

    private var detail: String {
        let cacheLabel = node.isCached ? "cached" : (node.isDriveDocument ? "not cached" : "linked")
        return "\(node.incomingCount) in, \(node.outgoingCount) out · \(cacheLabel)"
    }
}

private struct GraphCanvas: View {
    let nodes: [GraphNode]
    let edges: [GraphEdge]
    @Binding var selectedNodeId: String?
    let onOpen: (GraphNode) -> Void

    @State private var panOffset: CGSize = .zero
    @State private var dragStartOffset: CGSize?
    @State private var zoom: CGFloat = 1
    @State private var zoomStart: CGFloat?

    var body: some View {
        GeometryReader { proxy in
            let positions = layout()
            let nodeById = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
            let selectedId = selectedNodeId
            let visibleEdgeNodeIds = Set(edges.flatMap { [$0.source, $0.target] })

            ZStack {
                Canvas { context, size in
                    context.fill(
                        Path(CGRect(origin: .zero, size: size)),
                        with: .color(Color(red: 0.11, green: 0.11, blue: 0.11))
                    )

                    for edge in edges {
                        guard let start = positions[edge.source],
                              let end = positions[edge.target]
                        else {
                            continue
                        }
                        let startPoint = screenPoint(start, in: size)
                        let endPoint = screenPoint(end, in: size)
                        var path = Path()
                        path.move(to: startPoint)
                        path.addLine(to: endPoint)
                        let selected = selectedId == edge.source || selectedId == edge.target
                        context.stroke(
                            path,
                            with: .color(selected ? .accentColor.opacity(0.7) : .white.opacity(0.12)),
                            lineWidth: selected ? 1.5 : 0.8
                        )
                    }

                    for node in nodes {
                        guard let position = positions[node.id] else { continue }
                        drawNode(
                            node,
                            at: screenPoint(position, in: size),
                            in: &context,
                            isSelected: selectedId == node.id,
                            isConnected: visibleEdgeNodeIds.contains(node.id)
                        )
                    }

                    drawLabels(
                        nodes: nodes,
                        positions: positions,
                        selectedNodeId: selectedId,
                        connectedNodeIds: visibleEdgeNodeIds,
                        size: size,
                        context: &context
                    )
                }
                .gesture(dragGesture(in: proxy.size, positions: positions, nodeById: nodeById))
                .simultaneousGesture(zoomGesture())

                if nodes.isEmpty {
                    GraphPlaceholder(
                        title: "No graph data",
                        systemImage: "point.3.connected.trianglepath.dotted",
                        message: "Cached documents and Google Docs links will appear here."
                    )
                    .foregroundStyle(.white.opacity(0.82))
                }

                graphControls
                    .padding(14)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(red: 0.11, green: 0.11, blue: 0.11))
        .onChange(of: layoutSignature) { _ in
            resetViewport()
        }
    }

    private var graphControls: some View {
        HStack(spacing: 8) {
            Button {
                zoom = max(0.35, zoom * 0.82)
            } label: {
                Image(systemName: "minus.magnifyingglass")
            }
            Button {
                resetViewport()
            } label: {
                Image(systemName: "scope")
            }
            Button {
                zoom = min(3.5, zoom * 1.22)
            } label: {
                Image(systemName: "plus.magnifyingglass")
            }
        }
        .buttonStyle(.borderless)
        .labelStyle(.iconOnly)
        .foregroundStyle(.white.opacity(0.82))
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 8))
        .help("Zoom and reset graph view")
    }

    private var layoutSignature: String {
        nodes.map(\.id).joined(separator: "|") + "::" + edges.map(\.id).joined(separator: "|")
    }

    private func resetViewport() {
        panOffset = .zero
        dragStartOffset = nil
        zoom = 1
        zoomStart = nil
    }

    private func layout() -> [String: CGPoint] {
        guard !nodes.isEmpty else { return [:] }
        if nodes.count == 1 { return [nodes[0].id: .zero] }

        let sorted = nodes.sorted {
            let lhsDegree = $0.incomingCount + $0.outgoingCount
            let rhsDegree = $1.incomingCount + $1.outgoingCount
            if lhsDegree == rhsDegree {
                return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
            return lhsDegree > rhsDegree
        }
        let radius = max(320, sqrt(CGFloat(sorted.count)) * 36)
        let goldenAngle = CGFloat.pi * (3 - sqrt(5))
        var result: [String: CGPoint] = [:]

        for (index, node) in sorted.enumerated() {
            let t = CGFloat(index) + 0.5
            let distance = sqrt(t / CGFloat(sorted.count)) * radius
            let angle = t * goldenAngle
            let degree = CGFloat(node.incomingCount + node.outgoingCount)
            let inwardBias = degree > 0 ? max(0.56, 1 - degree * 0.035) : 1
            result[node.id] = CGPoint(
                x: cos(angle) * distance * inwardBias * 1.18,
                y: sin(angle) * distance * inwardBias * 0.82
            )
        }
        return result
    }

    private func screenPoint(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(
            x: size.width / 2 + panOffset.width + point.x * zoom,
            y: size.height / 2 + panOffset.height + point.y * zoom
        )
    }

    private func worldPoint(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(
            x: (point.x - size.width / 2 - panOffset.width) / max(zoom, 0.01),
            y: (point.y - size.height / 2 - panOffset.height) / max(zoom, 0.01)
        )
    }

    private func dragGesture(
        in size: CGSize,
        positions: [String: CGPoint],
        nodeById: [String: GraphNode]
    ) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if dragStartOffset == nil {
                    dragStartOffset = panOffset
                }
                guard let dragStartOffset else { return }
                panOffset = CGSize(
                    width: dragStartOffset.width + value.translation.width,
                    height: dragStartOffset.height + value.translation.height
                )
            }
            .onEnded { value in
                let distance = hypot(value.translation.width, value.translation.height)
                if distance < 5 {
                    panOffset = dragStartOffset ?? panOffset
                    if let hit = nearestNode(
                        to: worldPoint(value.location, in: size),
                        positions: positions,
                        nodeById: nodeById
                    ) {
                        if selectedNodeId == hit.id {
                            onOpen(hit)
                        } else {
                            selectedNodeId = hit.id
                        }
                    }
                }
                dragStartOffset = nil
            }
    }

    private func zoomGesture() -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                if zoomStart == nil {
                    zoomStart = zoom
                }
                let start = zoomStart ?? zoom
                zoom = min(3.5, max(0.35, start * value))
            }
            .onEnded { _ in
                zoomStart = nil
            }
    }

    private func nearestNode(
        to point: CGPoint,
        positions: [String: CGPoint],
        nodeById: [String: GraphNode]
    ) -> GraphNode? {
        let hitRadius = max(14 / max(zoom, 0.01), 9)
        return positions
            .compactMap { id, position -> (GraphNode, CGFloat)? in
                guard let node = nodeById[id] else { return nil }
                let distance = hypot(position.x - point.x, position.y - point.y)
                guard distance <= hitRadius else { return nil }
                return (node, distance)
            }
            .min { $0.1 < $1.1 }?
            .0
    }

    private func drawNode(
        _ node: GraphNode,
        at point: CGPoint,
        in context: inout GraphicsContext,
        isSelected: Bool,
        isConnected: Bool
    ) {
        let degree = node.incomingCount + node.outgoingCount
        let radius = isSelected ? 7.5 : min(6, 3.2 + CGFloat(degree) * 0.28)
        let rect = CGRect(
            x: point.x - radius,
            y: point.y - radius,
            width: radius * 2,
            height: radius * 2
        )
        let fill: Color
        if isSelected {
            fill = .accentColor
        } else if isConnected {
            fill = .white.opacity(0.62)
        } else if node.isCached {
            fill = .white.opacity(0.52)
        } else {
            fill = .white.opacity(0.42)
        }
        context.fill(Path(ellipseIn: rect), with: .color(fill))
        if isSelected {
            context.stroke(
                Path(ellipseIn: rect.insetBy(dx: -5, dy: -5)),
                with: .color(.accentColor.opacity(0.35)),
                lineWidth: 2
            )
        }
    }

    private func drawLabels(
        nodes: [GraphNode],
        positions: [String: CGPoint],
        selectedNodeId: String?,
        connectedNodeIds: Set<String>,
        size: CGSize,
        context: inout GraphicsContext
    ) {
        var occupied: [CGRect] = []
        let sorted = nodes.sorted {
            labelPriority($0, selectedNodeId: selectedNodeId, connectedNodeIds: connectedNodeIds)
                > labelPriority($1, selectedNodeId: selectedNodeId, connectedNodeIds: connectedNodeIds)
        }

        for node in sorted {
            guard shouldDrawLabel(node, selectedNodeId: selectedNodeId, connectedNodeIds: connectedNodeIds),
                  let position = positions[node.id]
            else {
                continue
            }
            let point = screenPoint(position, in: size)
            let title = labelTitle(node.title)
            let labelSize = estimatedLabelSize(title, selected: selectedNodeId == node.id)
            let rect = CGRect(
                x: point.x - labelSize.width / 2,
                y: point.y + 9,
                width: labelSize.width,
                height: labelSize.height
            )
            if selectedNodeId != node.id,
               occupied.contains(where: { $0.intersects(rect.insetBy(dx: -8, dy: -4)) }) {
                continue
            }
            occupied.append(rect)
            let text = Text(title)
                .font(.system(size: selectedNodeId == node.id ? 12 : 10, weight: selectedNodeId == node.id ? .semibold : .medium))
                .foregroundColor(selectedNodeId == node.id ? .white : .white.opacity(0.72))
            context.draw(text, at: CGPoint(x: rect.midX, y: rect.minY), anchor: .top)
        }
    }

    private func shouldDrawLabel(
        _ node: GraphNode,
        selectedNodeId: String?,
        connectedNodeIds: Set<String>
    ) -> Bool {
        if selectedNodeId == node.id { return true }
        if connectedNodeIds.contains(node.id) { return true }
        if node.isCached { return true }
        if nodes.count <= 90 { return true }
        return zoom >= 1.35
    }

    private func labelPriority(
        _ node: GraphNode,
        selectedNodeId: String?,
        connectedNodeIds: Set<String>
    ) -> Int {
        var priority = node.incomingCount + node.outgoingCount
        if selectedNodeId == node.id { priority += 10_000 }
        if connectedNodeIds.contains(node.id) { priority += 1_000 }
        if node.isCached { priority += 100 }
        return priority
    }

    private func labelTitle(_ title: String) -> String {
        let maxLength = zoom >= 1.5 ? 34 : 26
        guard title.count > maxLength else { return title }
        let end = title.index(title.startIndex, offsetBy: maxLength - 1)
        return String(title[..<end]) + "..."
    }

    private func estimatedLabelSize(_ title: String, selected: Bool) -> CGSize {
        CGSize(
            width: min(selected ? 220 : 180, max(18, CGFloat(title.count) * (selected ? 7 : 6))),
            height: selected ? 17 : 14
        )
    }
}

private struct GraphPlaceholder: View {
    let title: String
    let systemImage: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            if let message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
