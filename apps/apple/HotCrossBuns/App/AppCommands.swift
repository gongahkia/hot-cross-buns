import SwiftUI

extension Notification.Name {
    static let hcbZoomIn = Notification.Name("hcb.zoom.in")
    static let hcbZoomOut = Notification.Name("hcb.zoom.out")
    static let hcbZoomReset = Notification.Name("hcb.zoom.reset")
}

@MainActor
final class AppCommandActions {
    var newTask: () -> Void = {}
    var newNote: () -> Void = {}
    var newEvent: () -> Void = {}
    var refresh: () -> Void = {}
    var forceResync: () -> Void = {}
    var switchTo: (SidebarItem) -> Void = { _ in }
    var openSettingsWindow: () -> Void = {}
    var openDiagnostics: () -> Void = {}
    var openCommandPalette: () -> Void = {}
    var openHelp: () -> Void = {}
    var printToday: () -> Void = {}
    var exportDayICS: () -> Void = {}
    var exportWeekICS: () -> Void = {}
    var zoomIn: () -> Void = {}
    var zoomOut: () -> Void = {}
    var zoomReset: () -> Void = {}

    // Routes a canonical HCBShortcutCommand to the corresponding closure.
    // Used by the leader-chord state machine (§6.9) so chord execution reuses
    // the same action plumbing the menu bar and keyboard shortcuts already do.
    // Commands that have no corresponding AppCommandActions closure (calendar
    // navigation, task-inspector keys, store-specific) no-op — those live in
    // views that own their own focused handlers.
    func execute(_ command: HCBShortcutCommand) {
        switch command {
        case .newTask: newTask()
        case .newNote: newNote()
        case .newEvent: newEvent()
        case .commandPalette: openCommandPalette()
        case .refresh: refresh()
        case .forceResync: forceResync()
        case .diagnostics: openDiagnostics()
        case .help: openHelp()
        case .goToCalendar: switchTo(.calendar)
        case .goToStore: switchTo(.store)
        case .goToNotes: switchTo(.notes)
        case .goToSettings: openSettingsWindow()
        case .zoomIn: zoomIn()
        case .zoomOut: zoomOut()
        case .zoomReset: zoomReset()
        case .printToday: printToday()
        default: break
        }
    }
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
    // @AppStorage invalidates the Commands body when the JSON string
    // changes, so user-edited bindings take effect immediately without a
    // relaunch. AppModel.setShortcutBinding writes to this same key.
    @AppStorage(HCBShortcutStorage.userDefaultsKey) private var overridesJSON: String = "{}"

    private var overrides: [String: HCBKeyBinding] {
        HCBShortcutStorage.decode(overridesJSON)
    }

    private func binding(_ cmd: HCBShortcutCommand) -> HCBKeyBinding {
        overrides[cmd.rawValue] ?? cmd.defaultBinding
    }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            let newTask = binding(.newTask)
            Button("New Task") { actions?.newTask() }
                .keyboardShortcut(newTask.key.keyEquivalent, modifiers: newTask.modifiers.eventModifiers)
                .disabled(actions == nil)
            let newNote = binding(.newNote)
            Button("New Note") { actions?.newNote() }
                .keyboardShortcut(newNote.key.keyEquivalent, modifiers: newNote.modifiers.eventModifiers)
                .disabled(actions == nil)
            let newEvent = binding(.newEvent)
            Button("New Event") { actions?.newEvent() }
                .keyboardShortcut(newEvent.key.keyEquivalent, modifiers: newEvent.modifiers.eventModifiers)
                .disabled(actions == nil)
        }

        CommandGroup(replacing: .printItem) {
            let palette = binding(.commandPalette)
            Button("Command Palette…") { actions?.openCommandPalette() }
                .keyboardShortcut(palette.key.keyEquivalent, modifiers: palette.modifiers.eventModifiers)
                .disabled(actions == nil)
            let print = binding(.printToday)
            Button("Print Today…") { actions?.printToday() }
                .keyboardShortcut(print.key.keyEquivalent, modifiers: print.modifiers.eventModifiers)
                .disabled(actions == nil)
            Divider()
            Button("Export Day as .ics…") { actions?.exportDayICS() }
                .disabled(actions == nil)
            Button("Export Week as .ics…") { actions?.exportWeekICS() }
                .disabled(actions == nil)
        }

        CommandMenu("Sync") {
            let refresh = binding(.refresh)
            Button("Refresh") { actions?.refresh() }
                .keyboardShortcut(refresh.key.keyEquivalent, modifiers: refresh.modifiers.eventModifiers)
                .disabled(actions == nil)
            let force = binding(.forceResync)
            Button("Force Full Resync") { actions?.forceResync() }
                .keyboardShortcut(force.key.keyEquivalent, modifiers: force.modifiers.eventModifiers)
                .disabled(actions == nil)
            Divider()
            let diag = binding(.diagnostics)
            Button("Diagnostics and Recovery…") { actions?.openDiagnostics() }
                .keyboardShortcut(diag.key.keyEquivalent, modifiers: diag.modifiers.eventModifiers)
                .disabled(actions == nil)
        }

        CommandGroup(replacing: .help) {
            let help = binding(.help)
            Button("Hot Cross Buns Help…") { actions?.openHelp() }
                .keyboardShortcut(help.key.keyEquivalent, modifiers: help.modifiers.eventModifiers)
                .disabled(actions == nil)
        }

        CommandMenu("View") {
            ForEach(SidebarItem.allCases) { item in
                if let sidebarCommand = sidebarShortcutCommand(item) {
                    let b = binding(sidebarCommand)
                    Button(item.title) { actions?.switchTo(item) }
                        .keyboardShortcut(b.key.keyEquivalent, modifiers: b.modifiers.eventModifiers)
                        .disabled(actions == nil)
                } else {
                    Button(item.title) { actions?.switchTo(item) }
                        .disabled(actions == nil)
                }
            }
            Divider()
            let zIn = binding(.zoomIn)
            Button("Zoom In") { triggerZoomIn() }
                .keyboardShortcut(zIn.key.keyEquivalent, modifiers: zIn.modifiers.eventModifiers)
            let zOut = binding(.zoomOut)
            Button("Zoom Out") { triggerZoomOut() }
                .keyboardShortcut(zOut.key.keyEquivalent, modifiers: zOut.modifiers.eventModifiers)
            let zReset = binding(.zoomReset)
            Button("Actual Size") { triggerZoomReset() }
                .keyboardShortcut(zReset.key.keyEquivalent, modifiers: zReset.modifiers.eventModifiers)
        }
    }

    private func sidebarShortcutCommand(_ item: SidebarItem) -> HCBShortcutCommand? {
        switch item {
        case .calendar: .goToCalendar
        case .store: .goToStore
        case .notes: .goToNotes
        }
    }

    private func triggerZoomIn() {
        if let actions {
            actions.zoomIn()
        } else {
            NotificationCenter.default.post(name: .hcbZoomIn, object: nil)
        }
    }

    private func triggerZoomOut() {
        if let actions {
            actions.zoomOut()
        } else {
            NotificationCenter.default.post(name: .hcbZoomOut, object: nil)
        }
    }

    private func triggerZoomReset() {
        if let actions {
            actions.zoomReset()
        } else {
            NotificationCenter.default.post(name: .hcbZoomReset, object: nil)
        }
    }
}
