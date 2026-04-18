import SwiftUI

struct AppShell: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .today
    @State private var tabRouter = TabRouter()

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                let router = tabRouter.router(for: tab)
                NavigationStack(path: tabRouter.binding(for: tab)) {
                    tab.makeContentView()
                        .withAppDestinations()
                }
                .environment(router)
                .withSheetDestinations(sheet: tabRouter.sheetBinding(for: tab))
                .tabItem { tab.label }
                .tag(tab)
            }
        }
        .task {
            await model.loadInitialState()
            await model.restoreGoogleSession()
            await model.refreshForCurrentSyncMode()
        }
        .task(id: nearRealtimeLoopID) {
            await runNearRealtimeSyncLoop()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else {
                return
            }

            Task {
                await model.refreshForCurrentSyncMode()
            }
        }
        .onOpenURL { url in
            model.handleAuthRedirect(url)
        }
    }

    private var nearRealtimeLoopID: String {
        [
            model.settings.syncMode.rawValue,
            scenePhase == .active ? "active" : "inactive",
            model.account?.id ?? "signed-out"
        ].joined(separator: ":")
    }

    private func runNearRealtimeSyncLoop() async {
        guard scenePhase == .active, model.settings.syncMode == .nearRealtime, model.account != nil else {
            return
        }

        while Task.isCancelled == false {
            do {
                try await Task.sleep(for: .seconds(90))
                await model.refreshNow()
            } catch {
                return
            }
        }
    }
}

#Preview {
    AppShell()
        .environment(AppModel.preview)
}
