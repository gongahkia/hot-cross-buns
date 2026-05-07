import SwiftUI

struct HistoryEntryRow: View {
    let event: HistoryEvent

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
                .font(.title3)
                .frame(width: 22, alignment: .center)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.message.isEmpty ? event.kind.label : event.message)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(event.date.formatted(.relative(presentation: .numeric)))
                    Text("-")
                    Text(shortDocumentId(event.documentId))
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
    }

    private var systemImage: String {
        switch event.kind {
        case .pull: "arrow.down.circle"
        case .push: "arrow.up.circle"
        case .drain: "arrow.triangle.2.circlepath"
        case .conflict: "exclamationmark.triangle"
        case .drift: "triangle.lefthalf.filled"
        case .error: "xmark.octagon"
        case .import: "square.and.arrow.down"
        }
    }

    private var tint: Color {
        switch event.kind {
        case .pull, .push, .drain, .import: .accentColor
        case .conflict: .orange
        case .drift: .yellow
        case .error: .red
        }
    }
}
