import SwiftUI
import Combine

// Tab-scoped navigation state. Paths are intentionally empty-by-design now
// that the legacy full-screen TaskDetailView / EventDetailView have been
// replaced by edit sheets — every task/event surface is sheet-based. The
// path[] / navigate() vestiges are kept so future detail routes (e.g. a
// per-task attachment viewer) can slot in without reshuffling SheetDestination.
//
// Uses legacy ObservableObject (not @Observable) because the new Observation
// framework's .environment(value) propagation was failing for RouterPath
// across NavigationStack content boundaries — descendants (MonthGridView,
// etc.) got "No Observable object of type RouterPath found" even with the
// modifier present. Switching to @EnvironmentObject + .environmentObject
// goes through the older, battle-tested env-object machinery.
@MainActor
final class RouterPath: ObservableObject {
    @Published var path: [AppRoute] = []
    @Published var presentedSheet: SheetDestination?

    func navigate(to route: AppRoute) {
        path.append(route)
    }

    func present(_ sheet: SheetDestination) {
        guard presentedSheet != sheet else { return }
        presentedSheet = sheet
    }

    func replacePath(_ newPath: [AppRoute]) {
        guard path != newPath else { return }
        path = newPath
    }

    func reset() {
        if path.isEmpty == false {
            path = []
        }
        if presentedSheet != nil {
            presentedSheet = nil
        }
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
            set: { router.replacePath($0) }
        )
    }

    func sheetBinding(for key: String) -> Binding<SheetDestination?> {
        let router = router(for: key)
        return Binding(
            get: { router.presentedSheet },
            set: {
                guard router.presentedSheet != $0 else { return }
                router.presentedSheet = $0
            }
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
    case quickAddNote
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
    // Task-only variant — opened from Kanban column empty-space taps. Hides
    // the Event/Task switcher and pre-selects the list for the clicked column.
    case quickCreateTask(listID: TaskListMirror.ID?)
    // Note variant — opened from the Notes tab "New Note" button and the
    // global ⌘⇧N shortcut. Same sheet as quickCreateTask but labelled
    // "New Note" and defaults hasDueDate = false. Adding a due date later
    // promotes the note into a task (by moving it out of the Notes tab and
    // into the Tasks tab — both are Google-side the same TaskMirror).
    case quickCreateNote(listID: TaskListMirror.ID?)
    case convertEventToTask(CalendarEventMirror.ID)
    case convertEventToNote(CalendarEventMirror.ID)
    case convertTaskToEvent(TaskMirror.ID)
    case convertTaskToNote(TaskMirror.ID)
    case convertNoteToTask(TaskMirror.ID)
    case convertNoteToEvent(TaskMirror.ID)
    case syncSettings
    case diagnostics

    var id: String {
        switch self {
        case .addTask: "addTask"
        case .editTask(let id): "editTask-\(id)"
        case .quickAddTask: "quickAddTask"
        case .quickAddNote: "quickAddNote"
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
        case .quickCreateTask(let listID):
            "quickCreateTask-\(listID ?? "any")"
        case .quickCreateNote(let listID):
            "quickCreateNote-\(listID ?? "any")"
        case .convertEventToTask(let id): "convertEventToTask-\(id)"
        case .convertEventToNote(let id): "convertEventToNote-\(id)"
        case .convertTaskToEvent(let id): "convertTaskToEvent-\(id)"
        case .convertTaskToNote(let id): "convertTaskToNote-\(id)"
        case .convertNoteToTask(let id): "convertNoteToTask-\(id)"
        case .convertNoteToEvent(let id): "convertNoteToEvent-\(id)"
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

    // SheetHost wraps content in a view that observes router via @ObservedObject
    // so SwiftUI re-renders the .sheet host when router.presentedSheet changes —
    // without this, calling router.present(...) updates the @Published property
    // but no view in the .sheet's host chain observes router, so the binding
    // never gets re-checked and the sheet only appears after some unrelated
    // re-render (e.g. tab switch).
    func withSheetDestinations(router: RouterPath) -> some View {
        SheetHost(router: router) { self }
    }
}

private struct SheetHost<Content: View>: View {
    @ObservedObject var router: RouterPath
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .sheet(item: $router.presentedSheet) { destination in
                SheetDestinationHost(destination: destination, router: router)
                    .environment(\.routerPath, router)
            }
    }
}

private struct SheetDestinationHost: View {
    @Environment(AppModel.self) private var model
    let destination: SheetDestination
    let router: RouterPath

    var body: some View {
        sheetBody
            .environment(\.routerPath, router)
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
        case .quickAddNote:
            QuickAddView(noteMode: true)
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
        case .quickCreateTask(let listID):
            QuickCreatePopover(initialDate: Date(), isAllDay: true, taskOnly: true, initialTaskListID: listID)
        case .quickCreateNote(let listID):
            QuickCreatePopover(initialDate: Date(), isAllDay: true, taskOnly: true, initialTaskListID: listID, noteMode: true)
        case .convertEventToTask(let id):
            conversionSheet(intent: model.event(id: id).map(ConversionIntent.eventToTask))
        case .convertEventToNote(let id):
            conversionSheet(intent: model.event(id: id).map(ConversionIntent.eventToNote))
        case .convertTaskToEvent(let id):
            conversionSheet(intent: model.task(id: id).map(ConversionIntent.taskToEvent))
        case .convertTaskToNote(let id):
            conversionSheet(intent: model.task(id: id).map(ConversionIntent.taskToNote))
        case .convertNoteToTask(let id):
            conversionSheet(intent: model.task(id: id).map(ConversionIntent.noteToTask))
        case .convertNoteToEvent(let id):
            conversionSheet(intent: model.task(id: id).map(ConversionIntent.noteToEvent))
        case .syncSettings:
            SyncSettingsSheet()
        case .diagnostics:
            DiagnosticsView()
        }
    }

    @ViewBuilder
    private func conversionSheet(intent: ConversionIntent?) -> some View {
        if let intent {
            ConversionSheet(intent: intent)
        } else {
            ContentUnavailableView("Source not found", systemImage: "arrow.triangle.swap",
                                   description: Text("The item you're converting may have been deleted on Google."))
        }
    }
}

// Non-observing env-key for RouterPath. Most consumers only need to call
// router.present(...) or router.navigate(...) — they never *display* router
// state, so they shouldn't subscribe to its publishes (which would re-render
// every grid cell on every router mutation, causing severe lag). Reads via
// @Environment(\.routerPath) get a plain reference; only views that need to
// react to router state changes (e.g. SheetHost) use @ObservedObject.
private struct RouterPathKey: EnvironmentKey {
    static let defaultValue: RouterPath? = nil
}

extension EnvironmentValues {
    var routerPath: RouterPath? {
        get { self[RouterPathKey.self] }
        set { self[RouterPathKey.self] = newValue }
    }
}
