import SwiftUI

struct AppStatusBanner: View {
    let syncState: SyncState
    let authState: AuthState
    let retry: () -> Void
    let dismiss: () -> Void

    var body: some View {
        if let failure = failureContext {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: failure.systemImage)
                    .font(.title3)
                    .foregroundStyle(failure.tint)
                VStack(alignment: .leading, spacing: 4) {
                    Text(failure.title)
                        .font(.headline)
                    Text(failure.message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if failure.canRetry {
                    Button("Retry", action: retry)
                        .buttonStyle(.bordered)
                }
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss status message")
            }
            .padding(14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(failure.tint.opacity(0.35), lineWidth: 1)
            )
            .padding(.horizontal, 14)
            .padding(.top, 8)
        }
    }

    private var failureContext: FailureContext? {
        if case .failed(let message) = syncState {
            return FailureContext(
                title: "Sync needs attention",
                message: message,
                systemImage: "exclamationmark.arrow.triangle.2.circlepath",
                tint: AppColor.ember,
                canRetry: true
            )
        }

        if case .failed(let message) = authState {
            return FailureContext(
                title: "Google connection failed",
                message: message,
                systemImage: "person.crop.circle.badge.exclamationmark",
                tint: .red,
                canRetry: false
            )
        }

        return nil
    }
}

private struct FailureContext {
    var title: String
    var message: String
    var systemImage: String
    var tint: Color
    var canRetry: Bool
}

#Preview {
    AppStatusBanner(
        syncState: .failed(message: "Google API request failed with status 403."),
        authState: .signedOut,
        retry: {},
        dismiss: {}
    )
    .padding()
}
