import SwiftUI
import UserNotifications

struct NotificationsStep: View {
    @ObservedObject var vm: OnboardingViewModel
    @State private var status: UNAuthorizationStatus = .notDetermined
    @State private var requesting = false

    var body: some View {
        OnboardingStepCard(title: "Notifications", systemImage: "bell.badge.fill") {
            Text("Melon Pan can notify you about sync failures, audit drift, stalled sync, and new releases. Nothing is sent to Google when this is on.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(NotificationPrimerSheet.bullets, id: \.self) { bullet in
                    Text("• \(bullet)")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text("Current status: \(statusText)")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Button {
                    request()
                } label: {
                    Label("Enable Notifications", systemImage: "bell.badge")
                }
                .buttonStyle(.borderedProminent)
                .disabled(requesting || status != .notDetermined)

                Button("Not Now") {
                    vm.update { $0.notifications = .skipped }
                }
            }

            if requesting {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .task {
            await refreshStatus()
        }
    }

    private var statusText: String {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return "Enabled"
        case .denied:
            return "Denied"
        case .notDetermined:
            return "Not Asked"
        @unknown default:
            return "Unknown"
        }
    }

    private func request() {
        requesting = true
        AppNotifications.requestAuthorization()
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            await refreshStatus()
            requesting = false
        }
    }

    private func refreshStatus() async {
        let current = await AppNotifications.currentAuthorizationStatus()
        status = current
        switch current {
        case .authorized, .provisional, .ephemeral:
            vm.update { $0.notifications = .granted }
        case .denied:
            vm.update { $0.notifications = .denied }
        case .notDetermined:
            break
        @unknown default:
            break
        }
    }
}
