import SwiftUI

struct CacheSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Cache", systemImage: "externaldrive") {
            InfoRow(title: "Cache root", value: viewModel.cache.root, monospacedValue: true)
            InfoRow(title: "Snapshot disk usage", value: humanizeBytes(viewModel.cache.totalBytes))
            InfoRow(title: "Cached documents", value: "\(viewModel.cache.docCount)")
            InfoRow(title: "Snapshots", value: "\(viewModel.cache.snapshotCount)")
            InfoRow(title: "drive-tree.json modified", value: formatDate(viewModel.cache.driveTreeMtime))
        }
    }
}
