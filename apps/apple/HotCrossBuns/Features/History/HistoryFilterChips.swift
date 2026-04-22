import SwiftUI

// Horizontal row of toggleable category chips above the history list.
// Uses a ScrollView so the row never wraps awkwardly at small window
// widths — matches macOS Finder's tag-chip sidebar idiom.
struct HistoryFilterChips: View {
    @Binding var enabled: Set<String>

    private static let all: [(String, String, String)] = [
        ("create",    "Created",    "plus.circle"),
        ("edit",      "Edited",     "square.and.pencil"),
        ("delete",    "Deleted",    "trash"),
        ("complete",  "Completed",  "checkmark.circle"),
        ("duplicate", "Duplicated", "plus.square.on.square"),
        ("move",      "Moved",      "arrow.right.square"),
        ("clipboard", "Clipboard",  "doc.on.clipboard"),
        ("restore",   "Restored",   "arrow.uturn.backward.circle"),
        ("bulk",      "Bulk",       "square.grid.2x2"),
        ("sync",      "Sync",       "arrow.triangle.2.circlepath"),
        ("other",     "Other",      "circle"),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Self.all, id: \.0) { (key, title, icon) in
                    chip(key: key, title: title, icon: icon)
                }
            }
        }
    }

    private func chip(key: String, title: String, icon: String) -> some View {
        let isOn = enabled.contains(key)
        return Button {
            var new = enabled
            if isOn { new.remove(key) } else { new.insert(key) }
            enabled = new
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .hcbFont(.caption2, weight: .semibold)
                Text(title)
                    .hcbFont(.caption, weight: .medium)
            }
            .hcbScaledPadding(.horizontal, 10)
            .hcbScaledPadding(.vertical, 5)
            .background(
                Capsule().fill(isOn ? AppColor.ember.opacity(0.15) : AppColor.cream.opacity(0.4))
            )
            .overlay(
                Capsule().strokeBorder(isOn ? AppColor.ember : .secondary.opacity(0.25), lineWidth: 0.8)
            )
            .foregroundStyle(isOn ? AppColor.ember : AppColor.ink)
        }
        .buttonStyle(.plain)
        .help(isOn ? "Hide \(title.lowercased()) entries" : "Show \(title.lowercased()) entries")
    }
}
