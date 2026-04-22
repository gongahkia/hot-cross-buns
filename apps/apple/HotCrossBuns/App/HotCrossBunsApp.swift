import SwiftUI

@main
struct HotCrossBunsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appModel = AppModel.bootstrap()
    @State private var updater = UpdaterController()
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
                .hcbScaledFrame(minWidth: 900, minHeight: 600)
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

        // Dedicated Settings scene. macOS wires ⌘, automatically; the menu
        // item lives under the app menu as "Settings…" per the system
        // convention shown in Apple Calendar and peers. contentMinSize lets
        // the user resize the window while enforcing the minimum defined
        // on HCBSettingsWindow's frame.
        Settings {
            HCBSettingsWindow()
                .environment(appModel)
                .environment(updater)
                .environment(networkMonitor)
        }
        .windowResizability(.contentMinSize)

        MenuBarExtra(isInserted: menuBarInsertedBinding) {
            MenuBarExtraContent()
                .environment(appModel)
        } label: {
            Image("MenuBarIcon")
                .renderingMode(.template)
                .foregroundStyle(.black)
                .hcbScaledFrame(width: 18, height: 18)
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
