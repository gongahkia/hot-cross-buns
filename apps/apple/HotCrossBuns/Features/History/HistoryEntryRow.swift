import SwiftUI

// Single list row in HistoryWindow. Shows icon + summary + relative time
// on the left; right-side action is "Copy snapshot" when a priorSnapshotJSON
// is present (non-invertible ops) or nothing (a plain history record).
struct HistoryEntryRow: View {
    let entry: MutationAuditEntry
    let onSnapshotCopied: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: sfSymbol)
                .foregroundStyle(iconTint)
                .hcbFont(.subheadline, weight: .semibold)
                .hcbScaledFrame(width: 22, height: 22)
                .background(Circle().fill(iconTint.opacity(0.12)))
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.summary)
                    .hcbFont(.subheadline, weight: .medium)
                    .foregroundStyle(AppColor.ink)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(entry.timestamp.formatted(.relative(presentation: .numeric)))
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                    if let listTitle = entry.metadata["toListTitle"] ?? entry.metadata["list"] {
                        Text("·")
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                        Text(listTitle)
                            .hcbFont(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Text("·")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                    Text(entry.kind)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
            if entry.priorSnapshotJSON != nil || entry.postSnapshotJSON != nil {
                Button {
                    onSnapshotCopied()
                } label: {
                    Label("Copy snapshot", systemImage: "doc.on.clipboard")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help("Copies the recorded state as JSON so you can recreate it manually if needed.")
            }
        }
        .hcbScaledPadding(.vertical, 4)
    }

    private var sfSymbol: String {
        let k = entry.kind
        if k.hasSuffix(".create") { return "plus.circle" }
        if k.hasSuffix(".edit") { return "square.and.pencil" }
        if k.hasSuffix(".delete") { return "trash" }
        if k == "task.complete" { return "checkmark.circle.fill" }
        if k == "task.reopen" { return "arrow.uturn.backward.circle" }
        if k.hasPrefix("task.duplicate") { return "plus.square.on.square" }
        if k.hasPrefix("task.move") { return "arrow.right.square" }
        if k.hasPrefix("clipboard.") { return "doc.on.clipboard" }
        if k.hasSuffix(".restore") { return "arrow.uturn.backward.circle" }
        if k.hasPrefix("bulk.") { return "square.grid.2x2" }
        if k.hasPrefix("sync.") { return "arrow.triangle.2.circlepath" }
        return "circle"
    }

    private var iconTint: Color {
        let k = entry.kind
        if k.hasSuffix(".delete") { return AppColor.ember }
        if k == "task.complete" { return AppColor.moss }
        if k.hasPrefix("sync.") { return AppColor.blue }
        if k.hasPrefix("bulk.") { return AppColor.blue }
        if k.hasPrefix("task.move") { return AppColor.blue }
        if k.hasSuffix(".create") || k.hasPrefix("task.duplicate") { return AppColor.moss }
        return .secondary
    }
}
