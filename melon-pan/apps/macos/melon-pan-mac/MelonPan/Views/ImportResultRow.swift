import SwiftUI

struct ImportResultRow: View {
    let job: ImportJob
    var onOpenDraft: (String) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(job.sourcePath.lastPathComponent)
                    .lineLimit(1)
                Text(detailLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if case .succeeded(let draftId, let pushedDocumentId) = job.status {
                Button("Open") {
                    onOpenDraft(pushedDocumentId ?? draftId)
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.return, modifiers: [])
            }
        }
        .padding(.vertical, 4)
    }

    private var icon: String {
        switch job.status {
        case .pending: return "clock"
        case .running: return "arrow.triangle.2.circlepath"
        case .succeeded: return "checkmark.circle.fill"
        case .skipped: return "minus.circle"
        case .failed: return "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        switch job.status {
        case .pending: return .secondary
        case .running: return .accentColor
        case .succeeded: return .green
        case .skipped: return .orange
        case .failed: return .red
        }
    }

    private var detailLine: String {
        switch job.status {
        case .pending:
            return "\(formattedBytes(job.byteSize)) ready"
        case .running:
            return "Importing..."
        case .succeeded(let draftId, let pushedDocumentId):
            if let pushedDocumentId {
                return "Pushed to \(pushedDocumentId)"
            }
            return "Draft \(draftId)"
        case .skipped(let reason):
            return reason
        case .failed(let reason):
            return reason
        }
    }

    private func formattedBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
