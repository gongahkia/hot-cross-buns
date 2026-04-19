import Foundation

// A reversible mutation captured at the moment it fired. AppModel records
// one on every undoable action; UndoToast shows the most recent for ~6s
// with a button that asks AppModel to apply the inverse.
enum UndoableAction: Sendable, Equatable {
    // Completion toggle — undo flips the flag back.
    case taskCompletion(taskID: TaskMirror.ID, priorCompleted: Bool, title: String)
    // Delete on a persisted task — undo recreates it (new server ID, same
    // content). There is no Google Tasks "undelete" API, so a recreate is
    // the best we can do; position/subtask parent is preserved where possible.
    case taskDelete(snapshot: TaskMirror)
    // Edit that changed title / notes / due date — undo writes the snapshot
    // back through updateTask.
    case taskEdit(priorSnapshot: TaskMirror)
    // Delete on a persisted event — undo recreates (no "undelete" API).
    case eventDelete(snapshot: CalendarEventMirror)
    // Edit that changed summary / details / time / etc. — undo writes the
    // snapshot back through updateEvent.
    case eventEdit(priorSnapshot: CalendarEventMirror)

    var summary: String {
        switch self {
        case .taskCompletion(_, let prior, let title):
            return prior ? "Reopened \"\(title)\"" : "Completed \"\(title)\""
        case .taskDelete(let snap):
            return "Deleted \"\(snap.title)\""
        case .taskEdit(let snap):
            return "Edited \"\(snap.title)\""
        case .eventDelete(let snap):
            return "Deleted event \"\(snap.summary)\""
        case .eventEdit(let snap):
            return "Edited event \"\(snap.summary)\""
        }
    }

    var sfSymbol: String {
        switch self {
        case .taskCompletion(_, let prior, _): prior ? "arrow.uturn.backward.circle" : "checkmark.circle.fill"
        case .taskDelete, .eventDelete: "trash"
        case .taskEdit, .eventEdit: "square.and.pencil"
        }
    }
}
