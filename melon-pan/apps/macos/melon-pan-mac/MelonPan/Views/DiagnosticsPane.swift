import SwiftUI

struct DiagnosticsPane: View {
    @EnvironmentObject private var session: AppSession
    @StateObject private var viewModel = DiagnosticsViewModel()
    @State private var tab: Tab = .overview

    enum Tab: String, CaseIterable, Identifiable {
        case overview, sync, environment, recovery

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Overview"
            case .sync: return "Sync"
            case .environment: return "Environment"
            case .recovery: return "Recovery"
            }
        }

        var systemImage: String {
            switch self {
            case .overview: return "gauge.medium"
            case .sync: return "arrow.triangle.2.circlepath"
            case .environment: return "desktopcomputer"
            case .recovery: return "lifepreserver"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            DiagnosticsTabBar(selection: $tab)
            Divider()
            if let banner = viewModel.actionBanner {
                DiagnosticsActionBanner(text: banner.text, kind: banner.kind)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    switch tab {
                    case .overview:
                        AccountSection(viewModel: viewModel)
                        CacheSection(viewModel: viewModel)
                        BuildSection(viewModel: viewModel)
                    case .sync:
                        SyncSection(viewModel: viewModel)
                        AuditSection(viewModel: viewModel)
                    case .environment:
                        EnvironmentSection(viewModel: viewModel)
                        NetworkSection(viewModel: viewModel)
                        KeychainSection(viewModel: viewModel)
                    case .recovery:
                        RecoverySection(viewModel: viewModel)
                    }
                }
                .padding(20)
                .frame(maxWidth: 720, alignment: .leading)
            }
        }
        .task { await viewModel.refreshAll(session: session) }
        .onChange(of: tab) { newValue in
            Task { await viewModel.refreshTab(newValue, session: session) }
        }
        .background(KeyboardShortcuts(viewModel: viewModel, session: session))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct KeyboardShortcuts: View {
    @ObservedObject var viewModel: DiagnosticsViewModel
    let session: AppSession

    var body: some View {
        ZStack {
            Button("") { Task { await viewModel.refreshAll(session: session) } }
                .keyboardShortcut("r", modifiers: .command)
                .hidden()
            Button("") { Task { await viewModel.copyDiagnosticSummary(session: session) } }
                .keyboardShortcut("c", modifiers: .command)
                .hidden()
            Button("") { Task { await viewModel.exportSupportBundle(session: session) } }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .hidden()
        }
    }
}
