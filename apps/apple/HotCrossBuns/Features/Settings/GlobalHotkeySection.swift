import AppKit
import SwiftUI

struct GlobalHotkeySection: View {
    @Environment(AppModel.self) private var model
    @State private var isRecording = false

    var body: some View {
        Section("Global hotkey") {
            Toggle("Global quick-add hotkey", isOn: enabledBinding)
            HStack(alignment: .center, spacing: 10) {
                Text("Shortcut")
                Spacer()
                if isRecording {
                    GlobalHotkeyRecorderView { captured in
                        capture(captured)
                    }
                    .frame(width: 120, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.accentColor.opacity(0.18))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color.accentColor, lineWidth: 1)
                    )
                    Button("Cancel") {
                        isRecording = false
                    }
                    .buttonStyle(.borderless)
                } else {
                    Button(model.settings.globalHotkeyBinding.displayLabel) {
                        isRecording = true
                    }
                    .buttonStyle(.bordered)
                    .monospaced()

                    if model.settings.globalHotkeyBinding != .defaultQuickAdd {
                        Button("Reset") {
                            apply(binding: .defaultQuickAdd)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            Label(model.globalHotkeyRegistrationState.message, systemImage: statusIcon)
                .hcbFont(.footnote)
                .foregroundStyle(statusColor)
            Text("This is a system-wide shortcut for the floating quick-capture panel. If the combo is already reserved, Hot Cross Buns keeps your previous working shortcut instead of silently dropping it.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var enabledBinding: Binding<Bool> {
        Binding(
            get: { model.settings.enableGlobalHotkey },
            set: { newValue in
                if newValue {
                    let state = configure(enabled: true, binding: model.settings.globalHotkeyBinding)
                    switch state {
                    case .ready:
                        model.setEnableGlobalHotkey(true)
                    case .disabled, .failed:
                        model.setEnableGlobalHotkey(false)
                    }
                    model.setGlobalHotkeyRegistrationState(state)
                } else {
                    model.setEnableGlobalHotkey(false)
                    let state = configure(enabled: false, binding: model.settings.globalHotkeyBinding)
                    model.setGlobalHotkeyRegistrationState(state)
                }
            }
        )
    }

    private var statusIcon: String {
        switch model.globalHotkeyRegistrationState {
        case .disabled:
            "keyboard"
        case .ready:
            "checkmark.circle"
        case .failed:
            "exclamationmark.triangle"
        }
    }

    private var statusColor: Color {
        switch model.globalHotkeyRegistrationState {
        case .disabled:
            .secondary
        case .ready:
            AppColor.moss
        case .failed:
            AppColor.ember
        }
    }

    private func capture(_ binding: GlobalHotkeyBinding?) {
        defer { isRecording = false }
        guard let binding else { return }
        apply(binding: binding)
    }

    private func apply(binding: GlobalHotkeyBinding) {
        let previous = model.settings.globalHotkeyBinding
        let state = configure(enabled: model.settings.enableGlobalHotkey, binding: binding)
        switch state {
        case .disabled:
            model.setGlobalHotkeyBinding(binding)
            model.setGlobalHotkeyRegistrationState(.disabled)
        case .ready:
            model.setGlobalHotkeyBinding(binding)
            model.setGlobalHotkeyRegistrationState(state)
        case .failed(let message):
            if model.settings.enableGlobalHotkey {
                _ = configure(enabled: true, binding: previous)
                model.setGlobalHotkeyRegistrationState(.failed("\(message) Current hotkey remains \(previous.displayLabel)."))
            } else {
                model.setGlobalHotkeyBinding(binding)
                model.setGlobalHotkeyRegistrationState(.failed(message))
            }
        }
    }

    private func configure(enabled: Bool, binding: GlobalHotkeyBinding) -> GlobalHotkeyRegistrationState {
        guard let delegate = NSApp.delegate as? AppDelegate else {
            return .failed("Hotkey registration is unavailable right now.")
        }
        delegate.appModel = model
        return delegate.configureGlobalHotkey(enabled: enabled, binding: binding)
    }
}

struct GlobalHotkeyRecorderView: NSViewRepresentable {
    let onCapture: (GlobalHotkeyBinding?) -> Void

    func makeNSView(context: Context) -> GlobalHotkeyRecorderNSView {
        let view = GlobalHotkeyRecorderNSView()
        view.onCapture = onCapture
        return view
    }

    func updateNSView(_ nsView: GlobalHotkeyRecorderNSView, context: Context) {}
}

final class GlobalHotkeyRecorderNSView: NSView {
    var onCapture: ((GlobalHotkeyBinding?) -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        DispatchQueue.main.async { [weak self] in
            self?.window?.makeFirstResponder(self)
        }
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onCapture?(nil)
            return
        }
        guard let binding = GlobalHotkeyBinding.binding(from: event) else {
            NSSound.beep()
            return
        }
        onCapture?(binding)
    }
}
