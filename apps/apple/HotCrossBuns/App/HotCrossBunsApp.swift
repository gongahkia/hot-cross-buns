import SwiftUI

@main
struct HotCrossBunsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appModel = AppModel.bootstrap()
    @State private var updater = UpdaterController()
    @State private var settingsRouter = RouterPath()
    @State private var networkMonitor = NetworkMonitor()

    init() {
        CrashReporter.install()
        AppLogger.info("app launch", category: .misc, metadata: [
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        ])
    }

    var body: some Scene {
        Window("Hot Cross Buns", id: "main") {
            MacSidebarShell()
                .environment(appModel)
                .environment(updater)
                .environment(networkMonitor)
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

        Settings {
            NavigationStack(path: Binding(
                get: { settingsRouter.path },
                set: { settingsRouter.path = $0 }
            )) {
                SettingsView()
                    .withAppDestinations()
            }
            .environment(appModel)
            .environment(updater)
            .environment(settingsRouter)
            .withSheetDestinations(sheet: Binding(
                get: { settingsRouter.presentedSheet },
                set: { settingsRouter.presentedSheet = $0 }
            ))
            .frame(minWidth: 540, idealWidth: 620, minHeight: 620, idealHeight: 720)
        }

        MenuBarExtra(isInserted: menuBarInsertedBinding) {
            MenuBarExtraContent()
                .environment(appModel)
        } label: {
            Image("MenuBarIcon")
                .renderingMode(.template)
                .foregroundStyle(.black)
                .frame(width: 18, height: 18)
                .accessibilityLabel("Hot Cross Buns")
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarInsertedBinding: Binding<Bool> {
        Binding(
            get: { appModel.settings.showMenuBarExtra },
            set: { appModel.setShowMenuBarExtra($0) }
        )
    }
}
