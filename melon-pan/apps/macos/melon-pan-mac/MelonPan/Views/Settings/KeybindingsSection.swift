import SwiftUI

struct KeybindingsSection: View {
    @ObservedObject var vm: SettingsViewModel
    @State private var recording: ShortcutCommand.ID?
    @State private var conflictMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SettingsStatusBanner(vm: vm)
            shortcutList
            if let conflictMessage {
                Label(conflictMessage, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            HStack {
                Text("Click a shortcut and press the new key combo. Escape cancels. Modifier keys are required except for function keys and arrows.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Reset all to defaults") {
                    vm.updateMac(\.shortcuts, .default)
                    conflictMessage = nil
                }
            }
        }
        .padding(18)
    }

    private var shortcutList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(ShortcutCommand.allCases) { command in
                    shortcutRow(command)
                    if command.id != ShortcutCommand.allCases.last?.id {
                        Divider()
                    }
                }
            }
            .background(.quaternary.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(.separator.opacity(0.65), lineWidth: 1)
            }
        }
    }

    private func shortcutRow(_ command: ShortcutCommand) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(command.title)
                Text(command.group)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            shortcutField(command)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func shortcutField(_ command: ShortcutCommand) -> some View {
        if recording == command.id {
            HStack(spacing: 8) {
                ShortcutRecorder { chord in
                    if let chord {
                        capture(chord, for: command)
                    }
                    recording = nil
                }
                .frame(width: 110, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.accentColor.opacity(0.18))
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.accentColor, lineWidth: 1)
                }
                Text("Press keys...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    recording = nil
                } label: {
                    Image(systemName: "xmark.circle")
                }
                .buttonStyle(.plain)
                .help("Cancel recording")
            }
        } else {
            HStack(spacing: 8) {
                Button {
                    guard !command.readOnly else { return }
                    recording = command.id
                } label: {
                    Text(displayShortcut(value(for: command)))
                        .font(.system(.body, design: .monospaced).weight(.medium))
                        .frame(minWidth: 82)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(.quaternary.opacity(0.42), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(command.readOnly)
                .help(command.readOnly ? "Managed by the macOS Settings scene" : "Click to record a new shortcut")

                if value(for: command) != command.defaultValue && !command.readOnly {
                    Button {
                        set(command.defaultValue, for: command)
                    } label: {
                        Image(systemName: "xmark.circle")
                    }
                    .buttonStyle(.plain)
                    .help("Reset to default")
                }
            }
        }
    }

    private func capture(_ chord: String, for command: ShortcutCommand) {
        if let conflict = ShortcutCommand.allCases.first(where: {
            $0.id != command.id && value(for: $0) == chord
        }) {
            conflictMessage = "\(displayShortcut(chord)) is already bound to \"\(conflict.title)\"."
            return
        }
        conflictMessage = nil
        set(chord, for: command)
    }

    private func value(for command: ShortcutCommand) -> String {
        let shortcuts = vm.settings.mac.shortcuts
        switch command.id {
        case "openPalette": return shortcuts.openPalette
        case "newDraft": return shortcuts.newDraft
        case "save": return shortcuts.save
        case "push": return shortcuts.push
        case "pull": return shortcuts.pull
        case "openSettings": return shortcuts.openSettings
        case "closeTab": return shortcuts.closeTab
        case "pane1": return shortcuts.pane1
        case "pane2": return shortcuts.pane2
        case "pane3": return shortcuts.pane3
        case "pane4": return shortcuts.pane4
        default: return shortcuts.pane5
        }
    }

    private func set(_ value: String, for command: ShortcutCommand) {
        switch command.id {
        case "openPalette": vm.updateShortcut(\.openPalette, value)
        case "newDraft": vm.updateShortcut(\.newDraft, value)
        case "save": vm.updateShortcut(\.save, value)
        case "push": vm.updateShortcut(\.push, value)
        case "pull": vm.updateShortcut(\.pull, value)
        case "openSettings": vm.updateShortcut(\.openSettings, value)
        case "closeTab": vm.updateShortcut(\.closeTab, value)
        case "pane1": vm.updateShortcut(\.pane1, value)
        case "pane2": vm.updateShortcut(\.pane2, value)
        case "pane3": vm.updateShortcut(\.pane3, value)
        case "pane4": vm.updateShortcut(\.pane4, value)
        default: vm.updateShortcut(\.pane5, value)
        }
    }
}

private struct ShortcutCommand: Identifiable {
    let id: String
    let title: String
    let group: String
    let defaultValue: String
    let readOnly: Bool

    static let allCases: [ShortcutCommand] = [
        .init(id: "openPalette", title: "Open palette", group: "App", defaultValue: "cmd+p", readOnly: false),
        .init(id: "newDraft", title: "New draft", group: "Document", defaultValue: "cmd+n", readOnly: false),
        .init(id: "save", title: "Save (push)", group: "Document", defaultValue: "cmd+s", readOnly: false),
        .init(id: "push", title: "Push", group: "Sync", defaultValue: "cmd+shift+s", readOnly: false),
        .init(id: "pull", title: "Pull", group: "Sync", defaultValue: "cmd+r", readOnly: false),
        .init(id: "openSettings", title: "Open settings", group: "App", defaultValue: "cmd+,", readOnly: true),
        .init(id: "closeTab", title: "Close tab", group: "Window", defaultValue: "cmd+w", readOnly: false),
        .init(id: "pane1", title: "Switch pane: Home", group: "Navigation", defaultValue: "cmd+1", readOnly: false),
        .init(id: "pane2", title: "Switch pane: Drive", group: "Navigation", defaultValue: "cmd+2", readOnly: false),
        .init(id: "pane3", title: "Switch pane: Conflicts", group: "Navigation", defaultValue: "cmd+3", readOnly: false),
        .init(id: "pane4", title: "Switch pane: Diagnostics", group: "Navigation", defaultValue: "cmd+4", readOnly: false),
        .init(id: "pane5", title: "Switch pane: Settings", group: "Navigation", defaultValue: "cmd+5", readOnly: false)
    ]
}
