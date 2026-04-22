import SwiftUI

// Horizontal row of native Toggle buttons above the history list. Uses
// SwiftUI 14+ `.toggleStyle(.button)` which renders as platform-appropriate
// pill-shaped toggles that respect the system chrome (light/dark, accent
// color). Scrollable so narrow windows don't clip.
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
                    Toggle(isOn: binding(for: key)) {
                        Label(title, systemImage: icon)
                    }
                    .toggleStyle(.button)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .help(enabled.contains(key) ? "Hide \(title.lowercased()) entries" : "Show \(title.lowercased()) entries")
                }
            }
        }
    }

    private func binding(for key: String) -> Binding<Bool> {
        Binding(
            get: { enabled.contains(key) },
            set: { isOn in
                var new = enabled
                if isOn { new.insert(key) } else { new.remove(key) }
                enabled = new
            }
        )
    }
}
