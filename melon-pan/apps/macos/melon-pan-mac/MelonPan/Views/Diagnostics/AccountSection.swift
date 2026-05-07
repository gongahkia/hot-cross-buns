import SwiftUI

struct AccountSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Account", systemImage: "person.crop.circle") {
            switch viewModel.account {
            case .loading:
                ProgressView().controlSize(.small)
            case .signedOut:
                InfoRow(title: "Status", value: "Not signed in")
            case .signedIn(let account, let scopes, let expiresAtUnix):
                InfoRow(title: "Account", value: account)
                InfoRow(title: "Scopes", value: scopes.isEmpty ? "Not available" : scopes.joined(separator: ", "))
                InfoRow(title: "Token expires", value: formatExpiry(expiresAtUnix), monospacedValue: true)
            case .error(let detail):
                InfoRow(title: "Error", value: detail)
            }
        }
    }

    private func formatExpiry(_ unix: UInt64?) -> String {
        guard let unix else { return "Not available" }
        let date = Date(timeIntervalSince1970: TimeInterval(unix))
        return "\(date.formatted(date: .abbreviated, time: .standard)) (\(unix))"
    }
}
