import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let globalHotkey = GlobalHotkey()

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
