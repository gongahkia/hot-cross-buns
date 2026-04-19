import AppKit
import SwiftUI

struct KeybindingsSection: View {
    @Environment(AppModel.self) private var model
    @State private var recording: HCBShortcutCommand?
    @State private var conflictMessage: String?

    var body: some View {
        Section("Keyboard shortcuts") {
            ForEach(HCBShortcutGroup.allCases) { group in
                groupRows(for: group)
            }
            if let conflictMessage {
                Text(conflictMessage)
                    .hcbFont(.footnote)
                    .foregroundStyle(AppColor.ember)
            }
            footer
        }
    }

    @ViewBuilder
    private func groupRows(for group: HCBShortcutGroup) -> some View {
        Text(group.title.uppercased())
            .hcbFont(.caption2, weight: .bold)
            .foregroundStyle(.secondary)
            .hcbScaledPadding(.top, 4)

        ForEach(HCBShortcutCommand.allCases.filter { $0.group == group }) { command in
            HStack {
                Text(command.title)
                Spacer()
                shortcutField(for: command)
            }
        }
    }

    @ViewBuilder
    private func shortcutField(for command: HCBShortcutCommand) -> some View {
        let effective = model.settings.shortcutOverrides[command.rawValue] ?? command.defaultBinding
        let isCustom = model.settings.shortcutOverrides[command.rawValue] != nil

        HStack(spacing: 6) {
            if recording == command {
                KeyRecorderView { newBinding in
                    if let newBinding {
                        let conflicts = hcbConflictingCommands(
                            proposed: newBinding,
                            for: command,
                            overrides: model.settings.shortcutOverrides
                        )
                        if let first = conflicts.first {
                            conflictMessage = "\(newBinding.displayLabel) is already bound to \"\(first.title)\". Rebind or reset that one first."
                        } else {
                            conflictMessage = nil
                            model.setShortcutBinding(command, binding: newBinding)
                        }
                    }
                    recording = nil
                }
                .frame(width: 140, height: 22)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(AppColor.ember.opacity(0.18))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(AppColor.ember, lineWidth: 1)
                )
                Text("Press keys…")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
                Button("Cancel") { recording = nil }
                    .buttonStyle(.borderless)
                    .hcbFont(.caption)
            } else {
                Button {
                    recording = command
                } label: {
                    Text(effective.displayLabel.isEmpty ? "—" : effective.displayLabel)
                        .hcbFont(.body, weight: .medium)
                        .monospaced()
                        .foregroundStyle(isCustom ? AppColor.ember : AppColor.ink)
                        .frame(minWidth: 80, alignment: .center)
                        .hcbScaledPadding(.horizontal, 8)
                        .hcbScaledPadding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 6)
                                .fill(.quaternary.opacity(0.4))
                        )
                }
                .buttonStyle(.plain)
                .help("Click to record a new shortcut")

                if isCustom {
                    Button {
                        model.setShortcutBinding(command, binding: nil)
                    } label: {
                        Image(systemName: "arrow.uturn.backward.circle")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Reset to default (\(command.defaultBinding.displayLabel))")
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Text("Click a shortcut and press the new key combo. Escape cancels. Modifier keys (⌘⇧⌥⌃) are required except for function keys and arrows.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Reset all to defaults") {
                model.resetAllShortcutBindings()
            }
            .buttonStyle(.borderless)
            .hcbFont(.caption)
            .disabled(model.settings.shortcutOverrides.isEmpty)
        }
    }
}

// NSView-based key recorder. Becomes first responder on appear and reports
// the next keyDown as an HCBKeyBinding (or nil on Escape / invalid combos).
struct KeyRecorderView: NSViewRepresentable {
    let onCapture: (HCBKeyBinding?) -> Void

    func makeNSView(context: Context) -> KeyRecorderNSView {
        let view = KeyRecorderNSView()
        view.onCapture = onCapture
        return view
    }

    func updateNSView(_ nsView: KeyRecorderNSView, context: Context) {}
}

final class KeyRecorderNSView: NSView {
    var onCapture: ((HCBKeyBinding?) -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        DispatchQueue.main.async { [weak self] in
            self?.window?.makeFirstResponder(self)
        }
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { // Escape
            onCapture?(nil)
            return
        }
        guard let binding = Self.binding(from: event) else {
            NSSound.beep()
            return
        }
        onCapture?(binding)
    }

    static func binding(from event: NSEvent) -> HCBKeyBinding? {
        var mods: HCBModifierSet = []
        if event.modifierFlags.contains(.command) { mods.insert(.command) }
        if event.modifierFlags.contains(.shift) { mods.insert(.shift) }
        if event.modifierFlags.contains(.option) { mods.insert(.option) }
        if event.modifierFlags.contains(.control) { mods.insert(.control) }

        let key: HCBKey
        switch event.keyCode {
        case 36: key = .returnKey // Return
        case 76: key = .returnKey // Enter (numpad)
        case 51: key = .delete
        case 117: key = .delete // forward delete
        case 48: key = .tab
        case 49: key = .space
        case 123: key = .leftArrow
        case 124: key = .rightArrow
        case 125: key = .downArrow
        case 126: key = .upArrow
        default:
            // Require a letter/number/punctuation character AND at least one
            // modifier (otherwise the user can't type normal text anywhere).
            guard mods.isEmpty == false else { return nil }
            guard let chars = event.charactersIgnoringModifiers, chars.isEmpty == false else { return nil }
            key = .char(String(chars.lowercased().first!))
        }
        return HCBKeyBinding(key: key, modifiers: mods)
    }
}
