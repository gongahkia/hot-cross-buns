import SwiftUI
import Observation

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

enum AppRoute: Hashable {
    case task(TaskMirror.ID)
    case event(CalendarEventMirror.ID)
}

enum SheetDestination: Identifiable, Hashable {
    case addTask
    case quickAddTask
    case addEvent
    case addEventAt(Date, allDay: Bool)
    case quickCreate(Date, allDay: Bool)
    case syncSettings
    case diagnostics
    case manageTaskLists

    var id: String {
        switch self {
        case .addTask:
            "addTask"
        case .quickAddTask:
            "quickAddTask"
        case .addEvent:
            "addEvent"
        case .addEventAt(let date, let allDay):
            "addEventAt-\(date.timeIntervalSince1970)-\(allDay)"
        case .quickCreate(let date, let allDay):
            "quickCreate-\(date.timeIntervalSince1970)-\(allDay)"
        case .syncSettings:
            "syncSettings"
        case .diagnostics:
            "diagnostics"
        case .manageTaskLists:
            "manageTaskLists"
        }
    }
}

extension View {
    func withAppDestinations() -> some View {
        navigationDestination(for: AppRoute.self) { route in
            switch route {
            case .task(let id):
                TaskDetailView(taskID: id)
            case .event(let id):
                EventDetailView(eventID: id)
            }
        }
    }

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
        case .quickAddTask:
            QuickAddView()
        case .addEvent:
            AddEventSheet()
        case .addEventAt(let date, let allDay):
            AddEventSheet(prefilledStart: date, prefilledIsAllDay: allDay)
        case .quickCreate(let date, let allDay):
            QuickCreatePopover(initialDate: date, isAllDay: allDay)
        case .syncSettings:
            SyncSettingsSheet()
        case .diagnostics:
            DiagnosticsView()
        case .manageTaskLists:
            ManageTaskListsSheet()
        }
    }
}
