import SwiftUI

@main
struct HotCrossBunsApp: App {
    @State private var appModel = AppModel.bootstrap()
    @State private var settingsRouter = RouterPath()

    var body: some Scene {
        WindowGroup {
            AppShell()
                .environment(appModel)
        }

        #if os(macOS)
        Settings {
            SettingsView()
                .environment(appModel)
                .environment(settingsRouter)
        }
        #endif
    }
}
