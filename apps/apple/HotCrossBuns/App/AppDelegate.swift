import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let globalHotkey = GlobalHotkey()
    let menuBarStatusController = HCBMenuBarStatusController()
    var appModel: AppModel?
    private let quickCapturePanelController = GlobalQuickCapturePanelController()

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Register as the Services provider so the selector declared in
        // Info.plist's NSServices block ("Create Hot Cross Buns task")
        // routes to handleCreateTaskService below. NSUpdateDynamicServices
        // nudges macOS to pick up the new declaration without a restart.
        NSApplication.shared.servicesProvider = self
        NSUpdateDynamicServices()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard HCBLaunchMode.current.isSmokeTest else { return }

        Task { @MainActor in
            // Give SwiftUI a brief window to finish scene creation, then
            // exit cleanly so CI can treat launch hangs/crashes as failures.
            try? await Task.sleep(for: .seconds(2))
            NSApplication.shared.terminate(nil)
        }
    }

    // Called by macOS when the user invokes the Services menu entry on a
    // text selection. The selector shape matches the Info.plist NSMessage
    // "handleCreateTaskService".
    @objc func handleCreateTaskService(
        _ pasteboard: NSPasteboard,
        userData: String?,
        error: AutoreleasingUnsafeMutablePointer<NSString>
    ) {
        guard let selection = pasteboard.string(forType: .string),
              selection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        else {
            error.pointee = "Hot Cross Buns needs a text selection to create a task."
            return
        }
        // Piggyback on the Share Extension's handoff path so a selection
        // captured via the Services menu flows through the same prefill →
        // QuickAdd pipeline.
        let item = SharedInboxItem(
            text: selection,
            createdAt: Date(),
            source: Bundle.main.bundleIdentifier
        )
        SharedInboxDefaults.append(item)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()

        if let overdueCount = appModel?.todaySnapshot.overdueCount, overdueCount > 0 {
            let noun = overdueCount == 1 ? "task" : "tasks"
            let item = NSMenuItem(title: "\(overdueCount) overdue \(noun)", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
            menu.addItem(.separator())
        }

        let newTask = NSMenuItem(title: "New Task", action: #selector(dockNewTask), keyEquivalent: "")
        newTask.target = self
        menu.addItem(newTask)

        let newEvent = NSMenuItem(title: "New Event", action: #selector(dockNewEvent), keyEquivalent: "")
        newEvent.target = self
        menu.addItem(newEvent)

        menu.addItem(.separator())

        let calendar = NSMenuItem(title: "Go to Calendar", action: #selector(dockGoToCalendar), keyEquivalent: "")
        calendar.target = self
        menu.addItem(calendar)

        let store = NSMenuItem(title: "Go to Store", action: #selector(dockGoToStore), keyEquivalent: "")
        store.target = self
        menu.addItem(store)

        return menu
    }

    @objc private func dockNewTask() {
        AppIntentHandoff.save(.addTask)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func dockNewEvent() {
        AppIntentHandoff.save(.addEvent)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func dockGoToCalendar() {
        AppIntentHandoff.save(.calendar)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func dockGoToStore() {
        AppIntentHandoff.save(.store)
        NSApp.activate(ignoringOtherApps: true)
    }

    func configureGlobalHotkey(enabled: Bool, binding: GlobalHotkeyBinding) -> GlobalHotkeyRegistrationState {
        guard enabled else {
            globalHotkey.uninstall()
            return .disabled
        }

        globalHotkey.action = { [weak self] in
            self?.triggerGlobalQuickAdd()
        }
        do {
            try globalHotkey.install(binding: binding)
            return .ready(binding.displayLabel)
        } catch {
            globalHotkey.uninstall()
            return .failed(error.localizedDescription)
        }
    }

    private func triggerGlobalQuickAdd() {
        guard let appModel else { return }
        quickCapturePanelController.present(model: appModel)
    }
}
