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
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") {
                    NotificationCenter.default.post(name: .hcbOpenSettingsTab, object: nil)
                }
                .keyboardShortcut(",", modifiers: [.command])
            }
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    updater.checkForUpdates()
                }
            }
        }

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
