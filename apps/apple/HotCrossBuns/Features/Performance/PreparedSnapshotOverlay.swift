import SwiftUI

struct PreparedSnapshotOverlay: View {
    var title: String = "Preparing view..."
    var message: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text(title)
                .hcbFont(.subheadline, weight: .semibold)
                .foregroundStyle(AppColor.ink)
            Text(message)
                .hcbFont(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .hcbScaledPadding(20)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(AppColor.cardStroke.opacity(0.45), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.08), radius: 18, x: 0, y: 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial.opacity(0.18))
    }
}
