import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let globalHotkey = GlobalHotkey()

    nonisolated func applicationWillFinishLaunching(_ notification: Notification) {
        // Register as the Services provider so the selector declared in
        // Info.plist's NSServices block ("Create Hot Cross Buns task")
        // routes to handleCreateTaskService below. NSUpdateDynamicServices
        // nudges macOS to pick up the new declaration without a restart.
        NSApplication.shared.servicesProvider = self
        NSUpdateDynamicServices()
    }

    // Called by macOS when the user invokes the Services menu entry on a
    // text selection. The selector shape matches the Info.plist NSMessage
    // "handleCreateTaskService".
    @objc nonisolated func handleCreateTaskService(
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
        let item = SharedInboxItem(text: selection, createdAt: Date())
        SharedInboxDefaults.append(item)
        Task { @MainActor in
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    }

    nonisolated func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()

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

    func setGlobalHotkeyEnabled(_ isEnabled: Bool) {
        if isEnabled {
            globalHotkey.action = { [weak self] in
                self?.triggerGlobalQuickAdd()
            }
            globalHotkey.install()
        } else {
            globalHotkey.uninstall()
        }
    }

    private func triggerGlobalQuickAdd() {
        AppIntentHandoff.save(.addTask)
        NSApp.activate(ignoringOtherApps: true)
    }
}
