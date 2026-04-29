import SwiftUI

@MainActor
struct GlobalHotkeyConfigurator {
    var configure: (Bool, GlobalHotkeyBinding, AppModel) -> GlobalHotkeyRegistrationState

    func callAsFunction(
        enabled: Bool,
        binding: GlobalHotkeyBinding,
        model: AppModel
    ) -> GlobalHotkeyRegistrationState {
        configure(enabled, binding, model)
    }
}

private struct GlobalHotkeyConfiguratorKey: EnvironmentKey {
    @MainActor
    static let defaultValue = GlobalHotkeyConfigurator { _, _, _ in
        .failed("Hotkey registration is unavailable right now.")
    }
}

extension EnvironmentValues {
    @MainActor
    var globalHotkeyConfigurator: GlobalHotkeyConfigurator {
        get { self[GlobalHotkeyConfiguratorKey.self] }
        set { self[GlobalHotkeyConfiguratorKey.self] = newValue }
    }
}
