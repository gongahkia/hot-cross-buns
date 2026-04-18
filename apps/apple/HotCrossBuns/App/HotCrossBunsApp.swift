import SwiftUI

@main
struct HotCrossBunsApp: App {
    @State private var appModel = AppModel.bootstrap()
    @State private var updater = UpdaterController()

    var body: some Scene {
        Window("Hot Cross Buns", id: "main") {
            MacSidebarShell()
                .environment(appModel)
                .environment(updater)
                .frame(minWidth: 900, minHeight: 600)
                .dockBadge(
                    overdueCount: appModel.todaySnapshot.overdueCount,
                    enabled: appModel.settings.showDockBadge
                )
        }
        .defaultSize(width: 1100, height: 720)
        .windowResizability(.contentMinSize)
        .commands {
            AppCommands()
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    updater.checkForUpdates()
                }
            }
        }

        MenuBarExtra("Hot Cross Buns", systemImage: menuBarSymbol, isInserted: menuBarInsertedBinding) {
            MenuBarExtraContent()
                .environment(appModel)
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarSymbol: String {
        appModel.todaySnapshot.overdueCount > 0 ? "checkmark.circle.badge.exclamationmark" : "checkmark.circle"
    }

    private var menuBarInsertedBinding: Binding<Bool> {
        Binding(
            get: { appModel.settings.showMenuBarExtra },
            set: { appModel.setShowMenuBarExtra($0) }
        )
    }
}
