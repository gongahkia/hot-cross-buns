import SwiftUI

struct AuditSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Audit triangle", systemImage: "triangle") {
            if viewModel.audit.isEmpty {
                InfoRow(title: "Status", value: "No documents open")
            } else {
                ForEach(viewModel.audit) { doc in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(doc.title)
                            .font(.subheadline.weight(.semibold))
                        if let error = doc.error {
                            InfoRow(title: "Status", value: "audit unavailable: \(error)")
                        } else {
                            InfoRow(title: "md <-> docs.json", value: doc.mdMatchesDocs ? "consistent" : "drift detected")
                            InfoRow(title: "docs.json <-> md", value: doc.docsMatchesMd ? "consistent" : "drift detected")
                            InfoRow(title: "md hash", value: doc.mdHash, monospacedValue: true)
                            InfoRow(title: "docs.json hash", value: doc.docsHash, monospacedValue: true)
                            InfoRow(title: "md from docs hash", value: doc.mdFromDocsHash, monospacedValue: true)
                            InfoRow(title: "docs from md hash", value: doc.docsFromMdHash, monospacedValue: true)
                        }
                    }
                    .padding(.vertical, 4)
                    Divider()
                }
            }
        }
    }
}
