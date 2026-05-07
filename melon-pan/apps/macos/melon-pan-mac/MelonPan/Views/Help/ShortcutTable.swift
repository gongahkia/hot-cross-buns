import SwiftUI

struct ShortcutTable: View {
    let entries: [ShortcutEntry]
    let highlight: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(entries) { entry in
                LabeledContent {
                    Text(entry.chord)
                        .font(.system(.callout, design: .monospaced, weight: .semibold))
                        .foregroundStyle(.secondary)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.command)
                            .font(.callout)
                        Text(entry.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 2)
                .background(Self.matches(entry, highlight: highlight) ? Color.yellow.opacity(0.15) : .clear)
            }
        }
    }

    static func matches(_ entry: ShortcutEntry, highlight: String) -> Bool {
        !highlight.isEmpty && [
            entry.command,
            entry.chord,
            entry.description
        ]
        .joined(separator: " ")
        .localizedCaseInsensitiveContains(highlight)
    }
}
