import SwiftUI
import AppKit

struct MenuBarVisibilityToggle: View {
    @AppStorage("hot-cross-buns.menuBar.enabled") private var enabled = true
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Toggle("Show Menu Bar Icon", isOn: Binding(get: { enabled }, set: { visible in
            if !visible {
                openWindow(id: "conversation")
                NSApp.activate(ignoringOtherApps: true)
            }
            enabled = visible
        }))
        .help("Keep Hot Cross Buns in the menu bar. Hiding the icon opens the full window; restore it here or in the Conversation menu.")
        .accessibilityIdentifier("hot-cross-buns.menu-bar.visible")
    }
}
