import SwiftUI

@MainActor
final class AppCommandActions {
    var newTask: () -> Void = {}
    var newEvent: () -> Void = {}
    var refresh: () -> Void = {}
    var forceResync: () -> Void = {}
    var switchTo: (SidebarItem) -> Void = { _ in }
    var openDiagnostics: () -> Void = {}
    var openCommandPalette: () -> Void = {}
    var openHelp: () -> Void = {}
    var zoomIn: () -> Void = {}
    var zoomOut: () -> Void = {}
    var zoomReset: () -> Void = {}
    var vimContextHandler: (VimAction) -> Bool = { _ in false }
    var isVimDetailFocused: Bool = false
}

private struct AppCommandActionsKey: FocusedValueKey {
    typealias Value = AppCommandActions
}

extension FocusedValues {
    var appCommandActions: AppCommandActions? {
        get { self[AppCommandActionsKey.self] }
        set { self[AppCommandActionsKey.self] = newValue }
    }
}

struct AppCommands: Commands {
    @FocusedValue(\.appCommandActions) private var actions

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Task") { actions?.newTask() }
                .keyboardShortcut("n", modifiers: [.command])
                .disabled(actions == nil)
            Button("New Event") { actions?.newEvent() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(actions == nil)
        }

        CommandGroup(replacing: .printItem) {
            Button("Command Palette…") { actions?.openCommandPalette() }
                .keyboardShortcut("p", modifiers: [.command])
                .disabled(actions == nil)
        }

        CommandMenu("Sync") {
            Button("Refresh") { actions?.refresh() }
                .keyboardShortcut("r", modifiers: [.command])
                .disabled(actions == nil)
            Button("Force Full Resync") { actions?.forceResync() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Divider()
            Button("Diagnostics and Recovery…") { actions?.openDiagnostics() }
                .keyboardShortcut("d", modifiers: [.command, .option])
                .disabled(actions == nil)
        }

        CommandGroup(replacing: .help) {
            Button("Hot Cross Buns Help") { actions?.openHelp() }
                .keyboardShortcut("?", modifiers: [.command])
                .disabled(actions == nil)
        }

        CommandMenu("View") {
            ForEach(SidebarItem.allCases) { item in
                if let shortcut = item.keyboardEquivalent {
                    Button(item.title) { actions?.switchTo(item) }
                        .keyboardShortcut(shortcut, modifiers: [.command])
                        .disabled(actions == nil)
                } else {
                    Button(item.title) { actions?.switchTo(item) }
                        .disabled(actions == nil)
                }
            }
            Divider()
            Button("Zoom In") { actions?.zoomIn() }
                .keyboardShortcut("=", modifiers: [.command])
                .disabled(actions == nil)
            Button("Zoom Out") { actions?.zoomOut() }
                .keyboardShortcut("-", modifiers: [.command])
                .disabled(actions == nil)
            Button("Actual Size") { actions?.zoomReset() }
                .keyboardShortcut("0", modifiers: [.command])
                .disabled(actions == nil)
        }
    }
}
