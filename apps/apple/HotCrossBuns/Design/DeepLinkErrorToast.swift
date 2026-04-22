import SwiftUI

// Ephemeral toast shown when a hotcrossbuns:// URL can't be parsed. Normal
// routes are silent; this surfaces typos and malformed scripts so a user
// firing a deep link isn't left wondering why nothing happened.
struct DeepLinkErrorToast: View {
    @Binding var message: String?
    // Auto-dismiss after this delay. Longer than UndoToast (6s) since the
    // message is diagnostic text the user may want to read in full.
    private let dismissAfter: Duration = .seconds(7)

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            if let message {
                content(message: message)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        try? await Task.sleep(for: dismissAfter)
                        // Guard — another error may have replaced this one; don't clobber.
                        if self.message == message { self.message = nil }
                    }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: message)
        .allowsHitTesting(message != nil)
    }

    private func content(message: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "link.badge.plus")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Deep link error")
                    .hcbFont(.subheadline, weight: .semibold)
                Text(message)
                    .hcbFont(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            Button { self.message = nil } label: {
                Image(systemName: "xmark")
                    .hcbFont(.caption)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .hcbScaledPadding(.horizontal, 16)
        .hcbScaledPadding(.vertical, 12)
        .hcbScaledFrame(maxWidth: 520)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(AppColor.cardStroke, lineWidth: 0.8)
        )
        .shadow(color: .black.opacity(0.15), radius: 10, x: 0, y: 3)
        .hcbScaledPadding(18)
    }
}
