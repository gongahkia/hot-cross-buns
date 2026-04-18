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
    private var routers: [AppTab: RouterPath] = [:]

    func router(for tab: AppTab) -> RouterPath {
        if let router = routers[tab] {
            return router
        }
        let router = RouterPath()
        routers[tab] = router
        return router
    }

    func binding(for tab: AppTab) -> Binding<[AppRoute]> {
        let router = router(for: tab)
        return Binding(
            get: { router.path },
            set: { router.path = $0 }
        )
    }

    func sheetBinding(for tab: AppTab) -> Binding<SheetDestination?> {
        let router = router(for: tab)
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
    case addEvent
    case syncSettings
    case diagnostics

    var id: String {
        switch self {
        case .addTask:
            "addTask"
        case .addEvent:
            "addEvent"
        case .syncSettings:
            "syncSettings"
        case .diagnostics:
            "diagnostics"
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
            switch destination {
            case .addTask:
                AddTaskSheet()
            case .addEvent:
                AddEventSheet()
            case .syncSettings:
                SyncSettingsSheet()
            case .diagnostics:
                DiagnosticsView()
            }
        }
    }
}
