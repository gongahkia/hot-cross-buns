import AppKit
import SwiftUI

struct ShortcutRecorder: NSViewRepresentable {
    let onRecord: (String?) -> Void

    func makeNSView(context: Context) -> RecorderView {
        let view = RecorderView()
        view.onRecord = onRecord
        DispatchQueue.main.async {
            view.window?.makeFirstResponder(view)
        }
        return view
    }

    func updateNSView(_ nsView: RecorderView, context: Context) {
        nsView.onRecord = onRecord
        DispatchQueue.main.async {
            nsView.window?.makeFirstResponder(nsView)
        }
    }

    final class RecorderView: NSView {
        var onRecord: ((String?) -> Void)?

        override var acceptsFirstResponder: Bool { true }

        override func keyDown(with event: NSEvent) {
            if event.keyCode == 53 {
                onRecord?(nil)
                return
            }
            guard let chord = Self.chord(from: event) else {
                return
            }
            onRecord?(chord)
        }

        private static func chord(from event: NSEvent) -> String? {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            var parts: [String] = []
            if flags.contains(.command) { parts.append("cmd") }
            if flags.contains(.shift) { parts.append("shift") }
            if flags.contains(.option) { parts.append("option") }
            if flags.contains(.control) { parts.append("control") }

            let key = keyName(event: event)
            guard !key.isEmpty else { return nil }
            guard !parts.isEmpty || key.hasPrefix("f") || key.hasPrefix("arrow") else {
                return nil
            }
            parts.append(key)
            return parts.joined(separator: "+")
        }

        private static func keyName(event: NSEvent) -> String {
            switch event.keyCode {
            case 36:
                return "return"
            case 48:
                return "tab"
            case 49:
                return "space"
            case 51:
                return "delete"
            case 123:
                return "arrow-left"
            case 124:
                return "arrow-right"
            case 125:
                return "arrow-down"
            case 126:
                return "arrow-up"
            case 122:
                return "f1"
            case 120:
                return "f2"
            case 99:
                return "f3"
            case 118:
                return "f4"
            case 96:
                return "f5"
            case 97:
                return "f6"
            case 98:
                return "f7"
            case 100:
                return "f8"
            case 101:
                return "f9"
            case 109:
                return "f10"
            case 103:
                return "f11"
            case 111:
                return "f12"
            default:
                return (event.charactersIgnoringModifiers ?? "")
                    .lowercased()
                    .replacingOccurrences(of: " ", with: "space")
            }
        }
    }
}

func displayShortcut(_ shortcut: String) -> String {
    shortcut
        .split(separator: "+")
        .map { part in
            switch part {
            case "cmd": return "⌘"
            case "shift": return "⇧"
            case "option": return "⌥"
            case "control": return "⌃"
            case "return": return "Return"
            case "delete": return "Delete"
            case "arrow-left": return "←"
            case "arrow-right": return "→"
            case "arrow-up": return "↑"
            case "arrow-down": return "↓"
            case "space": return "Space"
            default: return part.uppercased()
            }
        }
        .joined()
}
