import SwiftUI
import Observation

// Tab-scoped navigation state. Paths are intentionally empty-by-design now
// that the legacy full-screen TaskDetailView / EventDetailView have been
// replaced by edit sheets — every task/event surface is sheet-based. The
// path[] / navigate() vestiges are kept so future detail routes (e.g. a
// per-task attachment viewer) can slot in without reshuffling SheetDestination.
@MainActor
@Observable
final class RouterPath {
    var path: [AppRoute] = []
    var presentedSheet: SheetDestination?

    func navigate(to route: AppRoute) {
        path.append(route)
    }

    func present(_ sheet: SheetDestination) {
        presentedSheet = sheet
    }

    func reset() {
        path = []
        presentedSheet = nil
    }
}

@MainActor
@Observable
final class TabRouter {
    private var routers: [String: RouterPath] = [:]

    func router(for key: String) -> RouterPath {
        if let router = routers[key] {
            return router
        }
        let router = RouterPath()
        routers[key] = router
        return router
    }

    func binding(for key: String) -> Binding<[AppRoute]> {
        let router = router(for: key)
        return Binding(
            get: { router.path },
            set: { router.path = $0 }
        )
    }

    func sheetBinding(for key: String) -> Binding<SheetDestination?> {
        let router = router(for: key)
        return Binding(
            get: { router.presentedSheet },
            set: { router.presentedSheet = $0 }
        )
    }
}

// Deliberately empty. Held as a type so the NavigationStack's path Binding
// still type-checks even though no navigation destinations exist post-refactor.
enum AppRoute: Hashable {}

enum SheetDestination: Identifiable, Hashable {
    case addTask
    case editTask(TaskMirror.ID)
    case quickAddTask
    case quickAddEvent
    case addEvent
    case editEvent(CalendarEventMirror.ID)
    case addEventAt(Date, allDay: Bool)
    case addEventRange(Date, Date, allDay: Bool)
    case quickCreate(Date, allDay: Bool)
    // Click-and-drag entry point — lands users in the QuickCreatePopover
    // with the drag range pre-populated. Kept separate from .quickCreate so
    // single-point callers don't have to construct a trailing argument.
    case quickCreateRange(Date, Date, allDay: Bool)
    case syncSettings
    case diagnostics

    var id: String {
        switch self {
        case .addTask: "addTask"
        case .editTask(let id): "editTask-\(id)"
        case .quickAddTask: "quickAddTask"
        case .quickAddEvent: "quickAddEvent"
        case .addEvent: "addEvent"
        case .editEvent(let id): "editEvent-\(id)"
        case .addEventAt(let date, let allDay):
            "addEventAt-\(date.timeIntervalSince1970)-\(allDay)"
        case .addEventRange(let start, let end, let allDay):
            "addEventRange-\(start.timeIntervalSince1970)-\(end.timeIntervalSince1970)-\(allDay)"
        case .quickCreate(let date, let allDay):
            "quickCreate-\(date.timeIntervalSince1970)-\(allDay)"
        case .quickCreateRange(let start, let end, let allDay):
            "quickCreateRange-\(start.timeIntervalSince1970)-\(end.timeIntervalSince1970)-\(allDay)"
        case .syncSettings: "syncSettings"
        case .diagnostics: "diagnostics"
        }
    }
}

extension View {
    // withAppDestinations() is a no-op now that AppRoute has no cases. Left
    // as an identity modifier so existing call sites keep compiling; can be
    // deleted entirely once callers are pruned.
    func withAppDestinations() -> some View { self }

    func withSheetDestinations(sheet: Binding<SheetDestination?>) -> some View {
        self.sheet(item: sheet) { destination in
            SheetDestinationHost(destination: destination)
        }
    }
}

private struct SheetDestinationHost: View {
    @Environment(AppModel.self) private var model
    let destination: SheetDestination

    var body: some View {
        sheetBody
            .withHCBAppearance(model.settings)
    }

    @ViewBuilder
    private var sheetBody: some View {
        switch destination {
        case .addTask:
            AddTaskSheet()
        case .editTask(let id):
            if let task = model.task(id: id) {
                AddTaskSheet(existingTask: task)
            } else {
                ContentUnavailableView("Task not found", systemImage: "checklist",
                                       description: Text("This task may have been deleted in Google Tasks."))
            }
        case .quickAddTask:
            QuickAddView()
        case .quickAddEvent:
            QuickAddEventView()
        case .addEvent:
            AddEventSheet()
        case .editEvent(let id):
            if let event = model.event(id: id) {
                AddEventSheet(existingEvent: event)
            } else {
                ContentUnavailableView("Event not found", systemImage: "calendar.badge.exclamationmark",
                                       description: Text("This event may have been deleted in Google Calendar."))
            }
        case .addEventAt(let date, let allDay):
            AddEventSheet(prefilledStart: date, prefilledIsAllDay: allDay)
        case .addEventRange(let start, let end, let allDay):
            AddEventSheet(prefilledStart: start, prefilledIsAllDay: allDay, prefilledEnd: end)
        case .quickCreate(let date, let allDay):
            QuickCreatePopover(initialDate: date, isAllDay: allDay)
        case .quickCreateRange(let start, let end, let allDay):
            QuickCreatePopover(initialDate: start, isAllDay: allDay, initialEnd: end)
        case .syncSettings:
            SyncSettingsSheet()
        case .diagnostics:
            DiagnosticsView()
        }
    }
}
