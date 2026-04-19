import SwiftUI

// Every rebindable keyboard shortcut in the app. Each case carries a
// human-readable title, a group label for the Settings list, and a
// default binding. Modal-internal shortcuts (`.defaultAction` /
// `.cancelAction` / Tab navigation / Return on forms) are NOT listed
// here — they stay hardcoded because macOS convention treats them as
// always-Return / always-Escape.
enum HCBShortcutCommand: String, CaseIterable, Identifiable {
    // App menu / global
    case newTask
    case newEvent
    case commandPalette
    case printToday
    case refresh
    case forceResync
    case diagnostics
    case help
    // Navigation
    case goToCalendar
    case goToStore
    case goToSettings
    case zoomIn
    case zoomOut
    case zoomReset
    // Store
    case storeShowInspector
    case storeClearCompleted
    // Calendar
    case calendarTasksDrawer
    case calendarPrevious
    case calendarToday
    case calendarNext
    case calendarJumpBack
    case calendarJumpForward
    case calendarGoToDate
    case calendarDuplicateEvent
    case calendarFocusSearch
    // Task inspector
    case taskSaveAndClose
    case taskQuickSave
    case taskDelete
    case taskDuplicate

    var id: String { rawValue }

    var title: String {
        switch self {
        case .newTask: "New Task"
        case .newEvent: "New Event"
        case .commandPalette: "Command Palette"
        case .printToday: "Print Today"
        case .refresh: "Refresh Sync"
        case .forceResync: "Force Full Resync"
        case .diagnostics: "Diagnostics and Recovery"
        case .help: "Help"
        case .goToCalendar: "Go to Calendar"
        case .goToStore: "Go to Store"
        case .goToSettings: "Go to Settings"
        case .zoomIn: "Zoom In"
        case .zoomOut: "Zoom Out"
        case .zoomReset: "Actual Size"
        case .storeShowInspector: "Toggle Task Inspector"
        case .storeClearCompleted: "Clear Completed Tasks"
        case .calendarTasksDrawer: "Toggle Tasks Drawer"
        case .calendarPrevious: "Previous Period"
        case .calendarToday: "Jump to Today"
        case .calendarNext: "Next Period"
        case .calendarJumpBack: "Jump Back (larger)"
        case .calendarJumpForward: "Jump Forward (larger)"
        case .calendarGoToDate: "Go to Date…"
        case .calendarDuplicateEvent: "Duplicate Event"
        case .calendarFocusSearch: "Focus Calendar Search"
        case .taskSaveAndClose: "Save and Close Task"
        case .taskQuickSave: "Save Task"
        case .taskDelete: "Delete Task"
        case .taskDuplicate: "Duplicate Task"
        }
    }

    var group: HCBShortcutGroup {
        switch self {
        case .newTask, .newEvent, .commandPalette, .printToday,
             .refresh, .forceResync, .diagnostics, .help:
            .app
        case .goToCalendar, .goToStore, .goToSettings,
             .zoomIn, .zoomOut, .zoomReset:
            .navigation
        case .storeShowInspector, .storeClearCompleted:
            .store
        case .calendarTasksDrawer, .calendarPrevious, .calendarToday,
             .calendarNext, .calendarJumpBack, .calendarJumpForward,
             .calendarGoToDate, .calendarDuplicateEvent, .calendarFocusSearch:
            .calendar
        case .taskSaveAndClose, .taskQuickSave, .taskDelete, .taskDuplicate:
            .taskInspector
        }
    }

    var defaultBinding: HCBKeyBinding {
        switch self {
        case .newTask: .init(key: .char("n"), modifiers: [.command])
        case .newEvent: .init(key: .char("n"), modifiers: [.command, .shift])
        case .commandPalette: .init(key: .char("p"), modifiers: [.command])
        case .printToday: .init(key: .char("p"), modifiers: [.command, .shift])
        case .refresh: .init(key: .char("r"), modifiers: [.command])
        case .forceResync: .init(key: .char("r"), modifiers: [.command, .shift])
        case .diagnostics: .init(key: .char("d"), modifiers: [.command, .option])
        case .help: .init(key: .char("?"), modifiers: [.command])
        case .goToCalendar: .init(key: .char("1"), modifiers: [.command])
        case .goToStore: .init(key: .char("2"), modifiers: [.command])
        case .goToSettings: .init(key: .char("3"), modifiers: [.command])
        case .zoomIn: .init(key: .char("="), modifiers: [.command])
        case .zoomOut: .init(key: .char("-"), modifiers: [.command])
        case .zoomReset: .init(key: .char("0"), modifiers: [.command])
        case .storeShowInspector: .init(key: .char("i"), modifiers: [.command])
        case .storeClearCompleted: .init(key: .delete, modifiers: [.command])
        case .calendarTasksDrawer: .init(key: .char("j"), modifiers: [.command])
        case .calendarPrevious: .init(key: .leftArrow, modifiers: [.command])
        case .calendarToday: .init(key: .char("t"), modifiers: [.command])
        case .calendarNext: .init(key: .rightArrow, modifiers: [.command])
        case .calendarJumpBack: .init(key: .leftArrow, modifiers: [.command, .option])
        case .calendarJumpForward: .init(key: .rightArrow, modifiers: [.command, .option])
        case .calendarGoToDate: .init(key: .char("g"), modifiers: [.command, .shift])
        case .calendarDuplicateEvent: .init(key: .char("d"), modifiers: [.command])
        case .calendarFocusSearch: .init(key: .char("f"), modifiers: [.command])
        case .taskSaveAndClose: .init(key: .returnKey, modifiers: [.command, .shift])
        case .taskQuickSave: .init(key: .returnKey, modifiers: [.command])
        case .taskDelete: .init(key: .delete, modifiers: [.command])
        case .taskDuplicate: .init(key: .char("d"), modifiers: [.command])
        }
    }
}

enum HCBShortcutGroup: String, CaseIterable, Identifiable {
    case app
    case navigation
    case store
    case calendar
    case taskInspector

    var id: String { rawValue }

    var title: String {
        switch self {
        case .app: "App"
        case .navigation: "Navigation"
        case .store: "Store"
        case .calendar: "Calendar"
        case .taskInspector: "Task Inspector"
        }
    }
}

// Serializable key identifier. Mirrors the subset of KeyEquivalent we need.
enum HCBKey: Hashable, Codable {
    case char(String) // single character; stored lowercased except "?" etc.
    case returnKey
    case delete
    case escape
    case tab
    case space
    case leftArrow
    case rightArrow
    case upArrow
    case downArrow

    var keyEquivalent: KeyEquivalent {
        switch self {
        case .char(let s):
            return KeyEquivalent(s.first ?? " ")
        case .returnKey: return .return
        case .delete: return .delete
        case .escape: return .escape
        case .tab: return .tab
        case .space: return .space
        case .leftArrow: return .leftArrow
        case .rightArrow: return .rightArrow
        case .upArrow: return .upArrow
        case .downArrow: return .downArrow
        }
    }

    var displayLabel: String {
        switch self {
        case .char(let s): return s.uppercased()
        case .returnKey: return "↩"
        case .delete: return "⌫"
        case .escape: return "⎋"
        case .tab: return "⇥"
        case .space: return "␣"
        case .leftArrow: return "←"
        case .rightArrow: return "→"
        case .upArrow: return "↑"
        case .downArrow: return "↓"
        }
    }
}

struct HCBKeyBinding: Codable, Hashable {
    var key: HCBKey
    var modifiers: HCBModifierSet

    init(key: HCBKey, modifiers: HCBModifierSet) {
        self.key = key
        self.modifiers = modifiers
    }

    static func events(_ key: HCBKey, _ events: EventModifiers) -> HCBKeyBinding {
        HCBKeyBinding(key: key, modifiers: HCBModifierSet(events))
    }

    var displayLabel: String {
        modifiers.displayPrefix + key.displayLabel
    }
}

// EventModifiers isn't Codable, so we mirror it as an OptionSet-ish
// Codable set of strings. Only the 4 commonly-used modifiers.
struct HCBModifierSet: OptionSet, Codable, Hashable {
    let rawValue: Int

    static let command = HCBModifierSet(rawValue: 1 << 0)
    static let shift = HCBModifierSet(rawValue: 1 << 1)
    static let option = HCBModifierSet(rawValue: 1 << 2)
    static let control = HCBModifierSet(rawValue: 1 << 3)

    init(rawValue: Int) {
        self.rawValue = rawValue
    }

    init(_ events: EventModifiers) {
        var raw = 0
        if events.contains(.command) { raw |= 1 << 0 }
        if events.contains(.shift) { raw |= 1 << 1 }
        if events.contains(.option) { raw |= 1 << 2 }
        if events.contains(.control) { raw |= 1 << 3 }
        self.rawValue = raw
    }

    var eventModifiers: EventModifiers {
        var mods: EventModifiers = []
        if contains(.command) { mods.insert(.command) }
        if contains(.shift) { mods.insert(.shift) }
        if contains(.option) { mods.insert(.option) }
        if contains(.control) { mods.insert(.control) }
        return mods
    }

    var displayPrefix: String {
        var s = ""
        if contains(.control) { s += "⌃" }
        if contains(.option) { s += "⌥" }
        if contains(.shift) { s += "⇧" }
        if contains(.command) { s += "⌘" }
        return s
    }
}

// UserDefaults mirror so `AppCommands` (scene-level) can react to changes
// via @AppStorage. AppModel.setShortcutBinding writes to both AppSettings
// (canonical) and this key (for Commands reactivity).
enum HCBShortcutStorage {
    static let userDefaultsKey = "hcb.shortcutOverrides.json"

    static func current() -> [String: HCBKeyBinding] {
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey) else { return [:] }
        return (try? JSONDecoder().decode([String: HCBKeyBinding].self, from: data)) ?? [:]
    }

    static func persist(_ overrides: [String: HCBKeyBinding]) {
        if overrides.isEmpty {
            UserDefaults.standard.removeObject(forKey: userDefaultsKey)
            return
        }
        guard let data = try? JSONEncoder().encode(overrides) else { return }
        UserDefaults.standard.set(data, forKey: userDefaultsKey)
    }

    static func decode(_ json: String) -> [String: HCBKeyBinding] {
        guard let data = json.data(using: .utf8), json != "{}" else { return [:] }
        return (try? JSONDecoder().decode([String: HCBKeyBinding].self, from: data)) ?? [:]
    }
}

// Environment plumbing.
private struct HCBShortcutOverridesKey: EnvironmentKey {
    static let defaultValue: [String: HCBKeyBinding] = [:]
}

extension EnvironmentValues {
    var hcbShortcutOverrides: [String: HCBKeyBinding] {
        get { self[HCBShortcutOverridesKey.self] }
        set { self[HCBShortcutOverridesKey.self] = newValue }
    }
}

// Resolves the effective binding for a command (override or default).
@MainActor
func hcbEffectiveBinding(
    _ command: HCBShortcutCommand,
    overrides: [String: HCBKeyBinding]
) -> HCBKeyBinding {
    overrides[command.rawValue] ?? command.defaultBinding
}

extension View {
    // Apply a rebindable keyboard shortcut. Reads overrides from the env
    // and falls back to the command's default binding. Must be applied to
    // views whose ancestor sets `\.hcbShortcutOverrides` (the shell root
    // and the `AppCommands` scene commands both do).
    func hcbKeyboardShortcut(_ command: HCBShortcutCommand) -> some View {
        modifier(HCBKeyboardShortcutModifier(command: command))
    }
}

private struct HCBKeyboardShortcutModifier: ViewModifier {
    @Environment(\.hcbShortcutOverrides) private var overrides
    let command: HCBShortcutCommand

    func body(content: Content) -> some View {
        let binding = overrides[command.rawValue] ?? command.defaultBinding
        return content.keyboardShortcut(binding.key.keyEquivalent, modifiers: binding.modifiers.eventModifiers)
    }
}
