import AppKit
import Carbon.HIToolbox
import Observation

@MainActor
final class VimKeyboardMonitor {
    private var monitor: Any?
    private var translator = VimTranslator()

    var actionHandler: ((VimAction) -> Void)?
    var isEnabled: Bool = false {
        didSet {
            guard oldValue != isEnabled else { return }
            if isEnabled {
                install()
            } else {
                uninstall()
            }
        }
    }

    deinit {
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
    }

    private func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            return self.handle(event) ? nil : event
        }
    }

    private func uninstall() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
        translator.reset()
    }

    private func handle(_ event: NSEvent) -> Bool {
        guard isEnabled else { return false }
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).isDisjoint(with: [.command, .control, .option]) else {
            return false
        }
        if isFirstResponderEditingText() { return false }

        guard let characters = event.charactersIgnoringModifiers, characters.count == 1 else { return false }
        let character = characters.first!

        if let action = translator.consume(character) {
            actionHandler?(action)
            return true
        }
        // pending chord — swallow the keystroke so it doesn't leak to List
        return translator.pending != nil
    }

    private func isFirstResponderEditingText() -> Bool {
        let responder = NSApp.keyWindow?.firstResponder
        if responder is NSTextView { return true }
        if let control = responder as? NSControl, control.currentEditor() != nil { return true }
        if String(describing: type(of: responder as Any)).contains("TextField") { return true }
        return false
    }
}

enum VimActionDispatcher {
    @MainActor
    static func dispatch(_ action: VimAction, commands: AppCommandActions) {
        switch action {
        case .moveDown:
            postKeyPress(keyCode: UInt16(kVK_DownArrow))
        case .moveUp:
            postKeyPress(keyCode: UInt16(kVK_UpArrow))
        case .scrollTop:
            postKeyPress(keyCode: UInt16(kVK_Home))
        case .scrollBottom:
            postKeyPress(keyCode: UInt16(kVK_End))
        case .toggleComplete:
            postKeyPress(keyCode: UInt16(kVK_Space))
        case .deleteSelection:
            postKeyPress(keyCode: UInt16(kVK_Delete))
        case .openCommandPalette:
            commands.openCommandPalette()
        case .focusSearch:
            commands.focusSearch()
        }
    }

    @MainActor
    private static func postKeyPress(keyCode: UInt16) {
        guard let window = NSApp.keyWindow else { return }
        let location = NSPoint.zero
        let timestamp = ProcessInfo.processInfo.systemUptime
        if let down = NSEvent.keyEvent(
            with: .keyDown,
            location: location,
            modifierFlags: [],
            timestamp: timestamp,
            windowNumber: window.windowNumber,
            context: nil,
            characters: "",
            charactersIgnoringModifiers: "",
            isARepeat: false,
            keyCode: keyCode
        ) {
            NSApp.postEvent(down, atStart: false)
        }
        if let up = NSEvent.keyEvent(
            with: .keyUp,
            location: location,
            modifierFlags: [],
            timestamp: timestamp,
            windowNumber: window.windowNumber,
            context: nil,
            characters: "",
            charactersIgnoringModifiers: "",
            isARepeat: false,
            keyCode: keyCode
        ) {
            NSApp.postEvent(up, atStart: false)
        }
    }
}
