import SwiftUI

struct AppShell: View {
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
    }
}

#Preview {
    AppShell()
        .environment(AppModel.preview)
}
