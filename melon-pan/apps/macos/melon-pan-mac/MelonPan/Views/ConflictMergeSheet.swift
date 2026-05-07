import SwiftUI

struct ConflictMergeSheet: View {
    let report: RuntimeBridge.ConflictReport
    let onApply: ([String: String], [String: String]) -> Void
    let onKeepLocal: () -> Void
    let onDiscardLocal: () -> Void
    let onCancel: () -> Void

    @State private var decisions: [String: String]
    @State private var manualTexts: [String: String]
    @State private var selectedRegionId: String?

    init(
        report: RuntimeBridge.ConflictReport,
        onApply: @escaping ([String: String], [String: String]) -> Void,
        onKeepLocal: @escaping () -> Void,
        onDiscardLocal: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.report = report
        self.onApply = onApply
        self.onKeepLocal = onKeepLocal
        self.onDiscardLocal = onDiscardLocal
        self.onCancel = onCancel
        var initial: [String: String] = [:]
        var initialManualTexts: [String: String] = [:]
        for region in report.userDecision {
            initial[region.id] = "local"
            initialManualTexts[region.id] = region.localText
        }
        for region in report.destructive {
            initial[region.id] = "local"
        }
        _decisions = State(initialValue: initial)
        _manualTexts = State(initialValue: initialManualTexts)
        _selectedRegionId = State(initialValue: report.userDecision.first?.id ?? report.destructive.first?.id)
    }

    private var selectedRegion: RuntimeBridge.ConflictRegion? {
        report.userDecision.first(where: { $0.id == selectedRegionId })
    }

    private var selectedDestructive: RuntimeBridge.DestructiveConflict? {
        report.destructive.first(where: { $0.id == selectedRegionId })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HStack(spacing: 0) {
                conflictList
                    .frame(width: 320)
                Divider()
                detail
                    .frame(minWidth: 620, minHeight: 420)
            }
            Divider()
            footer
        }
        .frame(minWidth: 980, minHeight: 620)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.triangle.merge")
                .font(.title2)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Resolve document changes")
                    .font(.headline)
                Text("Base \(short(report.baseRevisionId)) -> Remote \(short(report.remoteRevisionId))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Label("\(report.userDecision.count) manual", systemImage: "person.crop.circle.badge.questionmark")
                .foregroundStyle(report.userDecision.isEmpty ? Color.secondary : Color.orange)
            Label("\(report.destructive.count) destructive", systemImage: "exclamationmark.triangle")
                .foregroundStyle(report.destructive.isEmpty ? Color.secondary : Color.red)
        }
        .padding(16)
    }

    private var conflictList: some View {
        List(selection: $selectedRegionId) {
            if !report.userDecision.isEmpty {
                Section("Needs decision") {
                    ForEach(report.userDecision) { region in
                        ConflictRegionRow(
                            title: region.title,
                            subtitle: regionSubtitle(region),
                            systemImage: regionSystemImage(region),
                            allowsManual: allowsManualResolution(region),
                            decision: Binding(
                                get: { decisions[region.id] ?? "local" },
                                set: { decisions[region.id] = $0 }
                            )
                        )
                        .tag(region.id)
                    }
                }
            }
            if !report.destructive.isEmpty {
                Section("Destructive") {
                    ForEach(report.destructive) { region in
                        ConflictRegionRow(
                            title: region.title,
                            subtitle: region.reason,
                            systemImage: "exclamationmark.triangle",
                            allowsManual: false,
                            decision: Binding(
                                get: { decisions[region.id] ?? "local" },
                                set: { decisions[region.id] = $0 }
                            )
                        )
                        .tag(region.id)
                    }
                }
            }
            if !report.localWins.isEmpty || !report.remoteWins.isEmpty {
                Section("Already classified") {
                    Text("\(report.localWins.count) local-only and \(report.remoteWins.count) remote-only change(s)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.sidebar)
    }

    @ViewBuilder
    private var detail: some View {
        if let region = selectedRegion {
            ConflictRegionDetail(
                region: region,
                decision: decisions[region.id] ?? "local",
                manualText: Binding(
                    get: { manualTexts[region.id] ?? region.localText },
                    set: { manualTexts[region.id] = $0 }
                )
            )
        } else if let destructive = selectedDestructive {
            VStack(alignment: .leading, spacing: 12) {
                Label(destructive.title, systemImage: "exclamationmark.triangle")
                    .font(.headline)
                Text(destructive.reason)
                    .foregroundStyle(.secondary)
                Text("Local operations")
                    .font(.subheadline.weight(.semibold))
                Text(destructive.localOperationIds.joined(separator: "\n"))
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                Spacer()
            }
            .padding(18)
        } else {
            VStack(spacing: 10) {
                Image(systemName: "arrow.triangle.merge")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("No conflict selected")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var footer: some View {
        HStack {
            Button("Cancel") {
                onCancel()
            }
            Spacer()
            Button("Discard Local Edits", role: .destructive) {
                onDiscardLocal()
            }
            Button("Keep Local and Retry") {
                onKeepLocal()
            }
            Button("Apply Choices") {
                onApply(decisions, manualTexts)
            }
            .keyboardShortcut(.defaultAction)
        }
        .padding(16)
    }

    private func regionSubtitle(_ region: RuntimeBridge.ConflictRegion) -> String {
        if region.kind == "tableCell",
           let row = region.rowIndex,
           let column = region.columnIndex {
            return "Table cell \(row + 1), \(column + 1) · \(region.localOperationIds.count) local op(s)"
        }
        if region.kind == "table" {
            return "Table shape · \(region.localOperationIds.count) local op(s)"
        }
        return "\(region.localOperationIds.count) local op(s)"
    }

    private func regionSystemImage(_ region: RuntimeBridge.ConflictRegion) -> String {
        switch region.kind {
        case "table", "tableCell":
            return "tablecells"
        default:
            return "text.alignleft"
        }
    }

    private func allowsManualResolution(_ region: RuntimeBridge.ConflictRegion) -> Bool {
        region.kind == "paragraph" || region.kind == "tableCell" || region.kind == "table"
    }

    private func short(_ revision: String) -> String {
        if revision.count <= 10 { return revision }
        return String(revision.prefix(10))
    }
}

private struct ConflictRegionRow: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let allowsManual: Bool
    @Binding var decision: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .lineLimit(2)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Picker("Decision", selection: $decision) {
                Text("Local").tag("local")
                Text("Remote").tag("remote")
                if allowsManual {
                    Text("Manual").tag("manual")
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        .padding(.vertical, 4)
    }
}

private struct ConflictRegionDetail: View {
    let region: RuntimeBridge.ConflictRegion
    let decision: String
    @Binding var manualText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(region.title)
                    .font(.headline)
                    .lineLimit(2)
                if let metadata = regionMetadata {
                    Text(metadata)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 12) {
                ConflictTextColumn(title: "Base", text: region.baseText)
                ConflictTextColumn(title: "Local", text: region.localText)
                ConflictTextColumn(title: "Remote", text: region.remoteText)
            }
            if decision == "manual" {
                if region.kind == "table" {
                    TableTopologyEditor(region: region, topologyText: $manualText)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Manual result")
                            .font(.subheadline.weight(.semibold))
                        TextEditor(text: $manualText)
                            .font(.system(.body, design: .default))
                            .frame(minHeight: region.kind == "tableCell" ? 90 : 130)
                            .background(.regularMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }
            Text("\(region.localOperationIds.count) queued operation(s)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(18)
    }

    private var regionMetadata: String? {
        if region.kind == "tableCell",
           let row = region.rowIndex,
           let column = region.columnIndex {
            let span = (region.rowSpan ?? 1, region.columnSpan ?? 1)
            return "cell \(row + 1), \(column + 1) · span \(span.0)x\(span.1)"
        }
        if region.kind == "table" {
            return "table shape"
        }
        return nil
    }
}

private struct ConflictTextColumn: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            ScrollView {
                Text(text.isEmpty ? "No text" : text)
                    .font(.system(.body, design: .default))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
            }
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct TableTopologyEditor: View {
    let region: RuntimeBridge.ConflictRegion
    @Binding var topologyText: String
    @State private var draft: TableTopologyDraft

    init(region: RuntimeBridge.ConflictRegion, topologyText: Binding<String>) {
        self.region = region
        _topologyText = topologyText
        _draft = State(initialValue: TableTopologyDraft.parse(topologyText.wrappedValue) ?? .empty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Manual table shape")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("Use Local") {
                    draft = TableTopologyDraft.parse(region.localText) ?? draft
                }
                Button("Use Remote") {
                    draft = TableTopologyDraft.parse(region.remoteText) ?? draft
                }
            }

            HStack(spacing: 18) {
                Stepper(value: $draft.rows, in: 1...200) {
                    LabeledContent("Rows") {
                        Text("\(draft.rows)")
                            .monospacedDigit()
                    }
                    .frame(width: 120)
                }
                Stepper(value: $draft.columns, in: 1...60) {
                    LabeledContent("Columns") {
                        Text("\(draft.columns)")
                            .monospacedDigit()
                    }
                    .frame(width: 140)
                }
                Spacer()
                Text("\(draft.merges.count) merge(s)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .top, spacing: 14) {
                TableTopologyPreview(draft: draft.normalized())
                    .frame(minWidth: 240, maxWidth: .infinity, minHeight: 170, maxHeight: 220)

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Merged cells")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button {
                            draft.addMerge()
                        } label: {
                            Label("Add merge", systemImage: "plus")
                        }
                    }

                    if draft.merges.isEmpty {
                        Text("No merged cells")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 90, alignment: .center)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(draft.merges) { merge in
                                    TableMergeEditorRow(
                                        merge: merge,
                                        row: intBinding(
                                            for: merge.id,
                                            keyPath: \.row,
                                            range: 1...max(1, draft.rows)
                                        ),
                                        column: intBinding(
                                            for: merge.id,
                                            keyPath: \.column,
                                            range: 1...max(1, draft.columns)
                                        ),
                                        rowSpan: intBinding(
                                            for: merge.id,
                                            keyPath: \.rowSpan,
                                            range: 1...max(1, draft.rows - merge.row + 1)
                                        ),
                                        columnSpan: intBinding(
                                            for: merge.id,
                                            keyPath: \.columnSpan,
                                            range: 1...max(1, draft.columns - merge.column + 1)
                                        ),
                                        onDelete: {
                                            draft.removeMerge(id: merge.id)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
                .frame(width: 300)
            }

            Text(serializedPreview)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .textSelection(.enabled)
        }
        .onChange(of: draft) { newValue in
            let normalized = newValue.normalized()
            if normalized != newValue {
                draft = normalized
            } else {
                topologyText = normalized.serialize()
            }
        }
        .onAppear {
            draft = draft.normalized()
            topologyText = draft.serialize()
        }
    }

    private var serializedPreview: String {
        draft.normalized().serialize().replacingOccurrences(of: "\n", with: " | ")
    }

    private func intBinding(
        for id: UUID,
        keyPath: WritableKeyPath<TableMergeDraft, Int>,
        range: ClosedRange<Int>
    ) -> Binding<Int> {
        Binding(
            get: {
                draft.merges.first(where: { $0.id == id })?[keyPath: keyPath] ?? range.lowerBound
            },
            set: { value in
                guard let index = draft.merges.firstIndex(where: { $0.id == id }) else { return }
                draft.merges[index][keyPath: keyPath] = min(max(value, range.lowerBound), range.upperBound)
                draft = draft.normalized()
            }
        )
    }
}

private struct TableMergeEditorRow: View {
    let merge: TableMergeDraft
    @Binding var row: Int
    @Binding var column: Int
    @Binding var rowSpan: Int
    @Binding var columnSpan: Int
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Merge")
                    .font(.caption.weight(.semibold))
                Spacer()
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
            }
            Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 6) {
                GridRow {
                    compactStepper("Row", value: $row)
                    compactStepper("Column", value: $column)
                }
                GridRow {
                    compactStepper("Rows", value: $rowSpan)
                    compactStepper("Columns", value: $columnSpan)
                }
            }
        }
        .padding(8)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func compactStepper(_ title: String, value: Binding<Int>) -> some View {
        Stepper(value: value, in: 1...999) {
            LabeledContent(title) {
                Text("\(value.wrappedValue)")
                    .monospacedDigit()
            }
        }
        .font(.caption)
    }
}

private struct TableTopologyPreview: View {
    let draft: TableTopologyDraft

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(1...min(draft.rows, 20), id: \.self) { row in
                    HStack(spacing: 4) {
                        ForEach(1...min(draft.columns, 12), id: \.self) { column in
                            tableCell(row: row, column: column)
                        }
                        if draft.columns > 12 {
                            Text("+\(draft.columns - 12)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .frame(width: 34, height: 24)
                        }
                    }
                }
                if draft.rows > 20 {
                    Text("+\(draft.rows - 20) more row(s)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
            }
            .padding(10)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func tableCell(row: Int, column: Int) -> some View {
        let state = draft.mergeState(row: row, column: column)
        return Text(state.label)
            .font(.caption2)
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(state.isCovered ? .secondary : .primary)
            .frame(width: 44, height: 26)
            .background(state.background)
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

private struct TableTopologyDraft: Equatable {
    var rows: Int
    var columns: Int
    var merges: [TableMergeDraft]

    static let empty = TableTopologyDraft(rows: 1, columns: 1, merges: [])

    static func parse(_ raw: String) -> TableTopologyDraft? {
        let normalized = raw.replacingOccurrences(of: "|", with: "\n")
        var rows: Int?
        var columns: Int?
        var merges: [TableMergeDraft] = []

        for rawLine in normalized.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("row:") {
                continue
            }
            if let parsed = parseRowsColumns(line) {
                rows = parsed.rows
                columns = parsed.columns
                continue
            }
            if let merge = parseCellSpan(line) ?? parseMergeLine(line) {
                if merge.rowSpan > 1 || merge.columnSpan > 1 {
                    merges.append(merge)
                }
            }
        }

        guard let rows, let columns else { return nil }
        return TableTopologyDraft(rows: max(1, rows), columns: max(1, columns), merges: merges).normalized()
    }

    func normalized() -> TableTopologyDraft {
        var copy = self
        copy.rows = min(max(copy.rows, 1), 200)
        copy.columns = min(max(copy.columns, 1), 60)
        copy.merges = copy.merges.map { merge in
            var next = merge
            next.row = min(max(next.row, 1), copy.rows)
            next.column = min(max(next.column, 1), copy.columns)
            next.rowSpan = min(max(next.rowSpan, 1), max(1, copy.rows - next.row + 1))
            next.columnSpan = min(max(next.columnSpan, 1), max(1, copy.columns - next.column + 1))
            return next
        }
        .filter { $0.rowSpan > 1 || $0.columnSpan > 1 }
        return copy
    }

    mutating func addMerge() {
        let defaultColumnSpan = columns > 1 ? 2 : 1
        let defaultRowSpan = defaultColumnSpan == 1 && rows > 1 ? 2 : 1
        merges.append(TableMergeDraft(row: 1, column: 1, rowSpan: defaultRowSpan, columnSpan: defaultColumnSpan))
        self = normalized()
    }

    mutating func removeMerge(id: UUID) {
        merges.removeAll { $0.id == id }
    }

    func serialize() -> String {
        var lines = ["rows:\(rows) columns:\(columns)"]
        for merge in merges {
            lines.append(
                "merge \(merge.row - 1) \(merge.column - 1) \(merge.rowSpan) \(merge.columnSpan)"
            )
        }
        return lines.joined(separator: "\n")
    }

    func mergeState(row: Int, column: Int) -> TableCellPreviewState {
        for merge in merges {
            let rowRange = merge.row..<(merge.row + merge.rowSpan)
            let columnRange = merge.column..<(merge.column + merge.columnSpan)
            if rowRange.contains(row), columnRange.contains(column) {
                if merge.row == row, merge.column == column {
                    return TableCellPreviewState(
                        label: "\(row),\(column)",
                        background: Color.accentColor.opacity(0.20),
                        isCovered: false
                    )
                }
                return TableCellPreviewState(
                    label: "",
                    background: Color.secondary.opacity(0.10),
                    isCovered: true
                )
            }
        }
        return TableCellPreviewState(label: "\(row),\(column)", background: Color.clear, isCovered: false)
    }

    private static func parseRowsColumns(_ line: String) -> (rows: Int, columns: Int)? {
        var rows: Int?
        var columns: Int?
        for part in line.split(whereSeparator: \.isWhitespace) {
            if part.hasPrefix("rows:") {
                rows = Int(part.dropFirst("rows:".count))
            } else if part.hasPrefix("columns:") {
                columns = Int(part.dropFirst("columns:".count))
            }
        }
        guard let rows, let columns else { return nil }
        return (rows, columns)
    }

    private static func parseCellSpan(_ line: String) -> TableMergeDraft? {
        guard line.hasPrefix("cell:"),
              let split = line.range(of: " span:") else { return nil }
        let cellPart = line[..<split.lowerBound].dropFirst("cell:".count)
        let spanPart = line[split.upperBound...]
        let cellValues = cellPart.split(separator: ":").compactMap { Int($0) }
        let spanValues = spanPart.split(separator: "x").compactMap { Int($0) }
        guard cellValues.count == 2, spanValues.count == 2 else { return nil }
        return TableMergeDraft(
            row: cellValues[0] + 1,
            column: cellValues[1] + 1,
            rowSpan: spanValues[0],
            columnSpan: spanValues[1]
        )
    }

    private static func parseMergeLine(_ line: String) -> TableMergeDraft? {
        guard line.hasPrefix("merge ") else { return nil }
        let values = line
            .dropFirst("merge ".count)
            .split(whereSeparator: \.isWhitespace)
            .compactMap { Int($0) }
        guard values.count == 4 else { return nil }
        return TableMergeDraft(
            row: values[0] + 1,
            column: values[1] + 1,
            rowSpan: values[2],
            columnSpan: values[3]
        )
    }
}

private struct TableMergeDraft: Identifiable, Equatable {
    let id: UUID
    var row: Int
    var column: Int
    var rowSpan: Int
    var columnSpan: Int

    init(
        id: UUID = UUID(),
        row: Int,
        column: Int,
        rowSpan: Int,
        columnSpan: Int
    ) {
        self.id = id
        self.row = row
        self.column = column
        self.rowSpan = rowSpan
        self.columnSpan = columnSpan
    }
}

private struct TableCellPreviewState {
    let label: String
    let background: Color
    let isCovered: Bool
}
