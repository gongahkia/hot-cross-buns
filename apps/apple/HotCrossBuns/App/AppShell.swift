import SwiftUI

struct AppShell: View {
    @Environment(AppModel.self) private var model
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
        }
        .onOpenURL { url in
            model.handleAuthRedirect(url)
        }
    }
}

#Preview {
    AppShell()
        .environment(AppModel.preview)
}
