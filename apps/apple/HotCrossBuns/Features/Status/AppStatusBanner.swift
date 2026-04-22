import SwiftUI

struct AppStatusBanner: View {
    let syncState: SyncState
    let authState: AuthState
    let mutationError: String?
    var isSyncPaused: Bool = false
    var quarantinedCount: Int = 0
    var conflictCount: Int = 0
    // Days elapsed since the previous launch. Nil on first launch / same-day
    // relaunch. Used to render an "N days since last open — fetching" row
    // during .syncing so a long-absence cold launch isn't a silent freeze.
    var daysSinceLastLaunch: Int? = nil
    var openDiagnostics: (() -> Void)? = nil
    let retry: () -> Void
    let dismiss: () -> Void

    var body: some View {
        if let failure = failureContext {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: failure.systemImage)
                    .hcbFont(.title3)
                    .foregroundStyle(failure.tint)
                VStack(alignment: .leading, spacing: 4) {
                    Text(failure.title)
                        .hcbFont(.headline)
                    Text(failure.message)
                        .hcbFont(.footnote)
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
                .buttonStyle(.borderless)
                .accessibilityLabel("Dismiss status message")
            }
            .hcbScaledPadding(14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(failure.tint.opacity(0.35), lineWidth: 1)
            )
            .hcbScaledPadding(.horizontal, 14)
            .hcbScaledPadding(.top, 8)
        } else if let info = infoContext {
            HStack(alignment: .center, spacing: 12) {
                ProgressView()
                    .controlSize(.small)
                Text(info.title)
                    .hcbFont(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Dismiss status message")
            }
            .hcbScaledPadding(.vertical, 10)
            .hcbScaledPadding(.horizontal, 14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .hcbScaledPadding(.horizontal, 14)
            .hcbScaledPadding(.top, 8)
        }
    }

    private var infoContext: InfoContext? {
        guard case .syncing = syncState else { return nil }
        guard let days = daysSinceLastLaunch, days >= 1 else { return nil }
        let suffix = days == 1 ? "day" : "days"
        return InfoContext(title: "\(days) \(suffix) since last open — fetching from Google…")
    }

    private var failureContext: FailureContext? {
        if case .failed(let message) = authState {
            return FailureContext(
                title: "Reconnect Google to keep syncing",
                message: message,
                systemImage: "person.crop.circle.badge.exclamationmark",
                tint: .red,
                canRetry: false
            )
        }

        if conflictCount > 0 {
            let noun = conflictCount == 1 ? "conflict" : "conflicts"
            return FailureContext(
                title: "\(conflictCount) sync \(noun) — whose change wins?",
                message: "Google rejected these writes because someone edited the same item elsewhere. Open Diagnostics to keep your change or take the server version.",
                systemImage: "arrow.triangle.branch",
                tint: .red,
                canRetry: false
            )
        }

        if quarantinedCount > 0 {
            let noun = quarantinedCount == 1 ? "change" : "changes"
            return FailureContext(
                title: "\(quarantinedCount) \(noun) need your attention",
                message: "Google rejected these writes after several retries. Open Diagnostics to review and retry or discard them.",
                systemImage: "exclamationmark.octagon",
                tint: .red,
                canRetry: false
            )
        }

        if let mutationError, mutationError.isEmpty == false {
            return FailureContext(
                title: "Last change didn't save",
                message: mutationError,
                systemImage: "exclamationmark.triangle",
                tint: AppColor.ember,
                canRetry: false
            )
        }

        if isSyncPaused {
            return FailureContext(
                title: "Sync paused — tap Retry when you're back online",
                message: "Google wasn't reachable after several attempts. Your local changes are safe and will sync when you retry.",
                systemImage: "pause.circle",
                tint: AppColor.ember,
                canRetry: true
            )
        }

        if case .failed(let message) = syncState {
            return FailureContext(
                title: "Couldn't reach Google — try Refresh",
                message: message,
                systemImage: "exclamationmark.arrow.triangle.2.circlepath",
                tint: AppColor.ember,
                canRetry: true
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

private struct InfoContext {
    var title: String
}

#Preview {
    AppStatusBanner(
        syncState: .failed(message: "Google API request failed with status 403."),
        authState: .signedOut,
        mutationError: nil,
        retry: {},
        dismiss: {}
    )
    .padding()
}
