import SwiftUI

struct NetworkSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Network", systemImage: "network") {
            switch viewModel.network {
            case .loading:
                ProgressView().controlSize(.small)
            case .reachable(let via, let lastSuccess, let rateLimitHits):
                InfoRow(title: "Reachability", value: "reachable")
                InfoRow(title: "Interface", value: via)
                InfoRow(title: "Last successful API call", value: formatDate(lastSuccess))
                InfoRow(title: "Rate-limit hits", value: "\(rateLimitHits)")
            case .unreachable(let reason):
                InfoRow(title: "Reachability", value: "unreachable")
                InfoRow(title: "Reason", value: reason)
            }
        }
    }
}
