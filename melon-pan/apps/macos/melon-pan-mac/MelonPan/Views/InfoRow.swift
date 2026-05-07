import SwiftUI

struct InfoRow: View {
    let title: String
    let value: String
    var monospacedValue = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(displayValue)
                .font(.system(.body, design: monospacedValue ? .monospaced : .default))
                .foregroundStyle(value.isEmpty ? .secondary : .primary)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var displayValue: String {
        value.isEmpty ? "Not available" : value
    }
}
