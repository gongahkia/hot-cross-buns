import SwiftUI

struct RecoverySection: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject var viewModel: DiagnosticsViewModel
    @State private var confirmation: RecoveryConfirmation?

    var body: some View {
        SectionContainer(title: "Recovery", systemImage: "lifepreserver") {
            Button { Task { await viewModel.refreshAll(session: session) } } label: {
                Label("Refresh now", systemImage: "arrow.clockwise")
            }
            .disabled(viewModel.isWorking)

            Button { confirmation = .forceFullResync } label: {
                Label("Force full resync", systemImage: "arrow.triangle.2.circlepath.circle")
            }
            .disabled(viewModel.isWorking || session.activeAccount == nil)

            Button(role: .destructive) { confirmation = .clearCachedDriveData } label: {
                Label("Clear cached Drive data", systemImage: "externaldrive.badge.xmark")
            }
            .disabled(viewModel.isWorking)

            Button { Task { await viewModel.reSignIn(session: session) } } label: {
                Label("Re-sign-in", systemImage: "person.crop.circle.badge.plus")
            }
            .disabled(viewModel.isWorking)

            Button { viewModel.openCacheInFinder(session: session) } label: {
                Label("Open cache in Finder", systemImage: "folder")
            }

            Divider()

            Button { Task { await viewModel.copyDiagnosticSummary(session: session) } } label: {
                Label("Copy diagnostic summary", systemImage: "doc.on.doc")
            }

            Button { Task { await viewModel.exportSupportBundle(session: session) } } label: {
                Label("Export support bundle...", systemImage: "square.and.arrow.up")
            }
        }
        .confirmationDialog(
            confirmation?.title ?? "Confirm",
            isPresented: confirmationBinding,
            titleVisibility: .visible
        ) {
            if let confirmation {
                Button(confirmation.actionTitle, role: confirmation.role) {
                    handle(confirmation)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(confirmation?.message ?? "")
        }
    }

    private var confirmationBinding: Binding<Bool> {
        Binding(
            get: { confirmation != nil },
            set: { presented in
                if presented == false {
                    confirmation = nil
                }
            }
        )
    }

    private func handle(_ confirmation: RecoveryConfirmation) {
        switch confirmation {
        case .forceFullResync:
            Task { await viewModel.forceFullResync(session: session) }
        case .clearCachedDriveData:
            Task { await viewModel.clearCachedDriveData(session: session) }
        }
        self.confirmation = nil
    }
}

private enum RecoveryConfirmation {
    case forceFullResync
    case clearCachedDriveData

    var title: String {
        switch self {
        case .forceFullResync: return "Force full resync?"
        case .clearCachedDriveData: return "Clear cached Drive data?"
        }
    }

    var actionTitle: String {
        switch self {
        case .forceFullResync: return "Force full resync"
        case .clearCachedDriveData: return "Clear cached data"
        }
    }

    var role: ButtonRole? {
        switch self {
        case .forceFullResync: return nil
        case .clearCachedDriveData: return .destructive
        }
    }

    var message: String {
        switch self {
        case .forceFullResync:
            return "Melon Pan will pull every cached document again and refresh the cached Drive tree."
        case .clearCachedDriveData:
            return "This removes cached docs, snapshots, and drive-tree.json. credentials.json and windows.json are preserved."
        }
    }
}
