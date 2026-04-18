import AppIntents
import Foundation

struct AddGoogleTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Google Task"
    static var description = IntentDescription("Open Hot Cross Buns to create a Google Task.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        AppIntentHandoff.save(.addTask)
        return .result(dialog: "Opening the task editor.")
    }
}

struct AddGoogleCalendarEventIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Google Calendar Event"
    static var description = IntentDescription("Open Hot Cross Buns to create a Google Calendar event.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        AppIntentHandoff.save(.addEvent)
        return .result(dialog: "Opening the event editor.")
    }
}

struct OpenHotCrossBunsTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Today in Hot Cross Buns"
    static var description = IntentDescription("Open the Today view in Hot Cross Buns.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        AppIntentHandoff.save(.today)
        return .result(dialog: "Opening Today.")
    }
}

struct HotCrossBunsShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor = .orange

    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddGoogleTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
                "Create a Google task in \(.applicationName)"
            ],
            shortTitle: "Add Task",
            systemImageName: "checklist"
        )

        AppShortcut(
            intent: AddGoogleCalendarEventIntent(),
            phrases: [
                "Add an event in \(.applicationName)",
                "Create a Google Calendar event in \(.applicationName)"
            ],
            shortTitle: "Add Event",
            systemImageName: "calendar.badge.plus"
        )

        AppShortcut(
            intent: OpenHotCrossBunsTodayIntent(),
            phrases: [
                "Open today in \(.applicationName)",
                "Show my day in \(.applicationName)"
            ],
            shortTitle: "Open Today",
            systemImageName: "sun.max"
        )
    }
}
