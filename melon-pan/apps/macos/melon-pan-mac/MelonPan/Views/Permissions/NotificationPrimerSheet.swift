import SwiftUI

struct NotificationPrimerSheet: View {
    let onEnable: () -> Void
    let onNotNow: () -> Void
    let onDontAskAgain: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Before macOS asks")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "bell.badge.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.tint)
                    .symbolRenderingMode(.hierarchical)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Let Melon Pan tell you when something needs attention")
                        .font(.title3.weight(.semibold))
                    Text("Melon Pan posts a small number of notifications, all about your local sync state. Nothing is sent to Google when this is on.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                ForEach(Self.bullets, id: \.self) { bullet in
                    Text("• \(bullet)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack {
                Button("Don't Ask Again", action: onDontAskAgain)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Not Now", action: onNotNow)
                    .keyboardShortcut(.cancelAction)
                Button("Enable Notifications", action: onEnable)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(minWidth: 460, idealWidth: 520)
    }

    static let bullets = [
        "Update available — when a new Melon Pan release is on GitHub.",
        "Sync failed — when a doc cannot push to Drive.",
        "Audit drift detected — when a remote doc no longer matches local cache.",
        "Sync stalled — when unsaved changes have not flushed for >60s."
    ]
}
