import SwiftUI

struct SnapshotBrowser: View {
    @EnvironmentObject private var vm: HistoryViewModel

    var body: some View {
        HSplitView {
            List(vm.documentIds, id: \.self, selection: $vm.selectedDocumentId) { documentId in
                VStack(alignment: .leading, spacing: 2) {
                    Text(title(for: documentId))
                        .lineLimit(1)
                    Text(shortDocumentId(documentId))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                .tag(documentId)
            }
            .frame(minWidth: 180, idealWidth: 240)

            List(selection: selectedSnapshotId) {
                ForEach(vm.snapshots[vm.selectedDocumentId ?? ""] ?? []) { snapshot in
                    SnapshotRow(snapshot: snapshot)
                        .tag(snapshot.id)
                }
            }
            .frame(minWidth: 260)
        }
        .task(id: vm.selectedDocumentId) {
            guard let id = vm.selectedDocumentId else { return }
            await vm.reloadSnapshots(documentId: id)
        }
    }

    private var selectedSnapshotId: Binding<String?> {
        Binding(
            get: { vm.selectedSnapshot?.id },
            set: { id in
                guard let id, let doc = vm.selectedDocumentId else {
                    vm.selectedSnapshot = nil
                    return
                }
                vm.selectedSnapshot = vm.snapshots[doc]?.first(where: { $0.id == id })
            }
        )
    }

    private func title(for documentId: String) -> String {
        RuntimeBridge.rehydrateDocument(cacheRoot: vm.cacheRoot, documentId: documentId)?.title
            ?? shortDocumentId(documentId)
    }
}

private struct SnapshotRow: View {
    let snapshot: SnapshotInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(snapshot.revisionOrStamp, systemImage: snapshot.kind.systemImage)
                .lineLimit(1)
                .truncationMode(.middle)
            HStack(spacing: 6) {
                Text(snapshot.kind.label)
                Text("-")
                Text(snapshot.createdAt.formatted(date: .abbreviated, time: .shortened))
                Text("-")
                Text(humanizeBytes(snapshot.sizeBytes))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

extension SnapshotInfo.Kind {
    var label: String {
        switch self {
        case .revision: "Revision"
        case .prePush: "Pre-push"
        }
    }

    var systemImage: String {
        switch self {
        case .revision: "doc.text"
        case .prePush: "arrow.up.doc"
        }
    }
}
