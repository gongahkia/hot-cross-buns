import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    nonisolated func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()

        let newTask = NSMenuItem(title: "New Task", action: #selector(dockNewTask), keyEquivalent: "")
        newTask.target = self
        menu.addItem(newTask)

        let newEvent = NSMenuItem(title: "New Event", action: #selector(dockNewEvent), keyEquivalent: "")
        newEvent.target = self
        menu.addItem(newEvent)

        menu.addItem(.separator())

        let today = NSMenuItem(title: "Go to Today", action: #selector(dockGoToToday), keyEquivalent: "")
        today.target = self
        menu.addItem(today)

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

    @objc private func dockGoToToday() {
        AppIntentHandoff.save(.today)
        NSApp.activate(ignoringOtherApps: true)
    }
}
