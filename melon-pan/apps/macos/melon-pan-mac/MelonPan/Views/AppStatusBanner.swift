import SwiftUI

struct AppStatusBanner: View {
    let banner: StatusBanner
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: banner.kind.systemImage)
                .font(.title3)
                .foregroundStyle(banner.kind.tint)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 4) {
                Text(banner.title)
                    .font(.headline)
                    .lineLimit(1)
                if let detail = banner.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 8)

            if let primaryAction = banner.primaryAction {
                Button(primaryAction.label, action: primaryAction.handler)
                    .buttonStyle(.bordered)
            }
            if let secondaryAction = banner.secondaryAction {
                Button(secondaryAction.label, action: secondaryAction.handler)
                    .buttonStyle(.bordered)
            }
            if banner.canDismiss {
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Dismiss \(banner.title)")
                .accessibilityAddTraits(.isButton)
            }
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(banner.kind.tint.opacity(0.35), lineWidth: 1)
        )
        .frame(maxHeight: 92)
        .clipped()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        let kind: String
        switch banner.kind {
        case .info: kind = "Info"
        case .success: kind = "Success"
        case .warning: kind = "Warning"
        case .error: kind = "Error"
        }
        return "\(kind) \(banner.title). \(banner.detail ?? "")"
    }
}

#Preview {
    AppStatusBanner(
        banner: StatusBanner(
            kind: .error,
            title: "Push failed",
            detail: "Google Docs rejected the request.",
            primaryAction: BannerAction(label: "Retry") {},
            secondaryAction: BannerAction(label: "View Diagnostics") {}
        ),
        dismiss: {}
    )
    .padding()
}
