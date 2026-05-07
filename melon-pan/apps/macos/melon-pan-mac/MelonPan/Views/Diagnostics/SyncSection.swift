import SwiftUI

struct SyncSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Sync", systemImage: "arrow.triangle.2.circlepath") {
            if viewModel.sync.isEmpty {
                InfoRow(title: "Open documents", value: "No documents open")
            } else {
                ForEach(viewModel.sync) { doc in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(doc.title)
                            .font(.subheadline.weight(.semibold))
                        InfoRow(title: "Document ID", value: doc.id, monospacedValue: true)
                        InfoRow(title: "Last pull", value: formatDate(doc.lastPull))
                        InfoRow(title: "Last push", value: formatDate(doc.lastPush))
                        InfoRow(title: "In flight", value: doc.inFlight ? "yes" : "no")
                        InfoRow(title: "Queued mutations", value: "\(doc.queuedMutations)")
                        InfoRow(title: "Pre-push snapshots", value: "\(doc.snapshotCount)")
                        InfoRow(title: "Failure", value: doc.hasFailure ? "yes" : "no")
                    }
                    .padding(.vertical, 4)
                    Divider()
                }
            }
        }
    }
}
