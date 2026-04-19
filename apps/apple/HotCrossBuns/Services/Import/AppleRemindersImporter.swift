import EventKit
import Foundation

// One-time migration from the system Reminders app into Google Tasks.
// Read-only on the EventKit side — we never write back to Reminders.
// The calling AppModel is responsible for creating the Google task lists
// and the tasks themselves; this service only returns the snapshot.
struct AppleRemindersImporter: Sendable {
    struct ImportedList: Equatable, Sendable {
        var name: String
        var reminders: [ImportedReminder]
    }

    struct ImportedReminder: Equatable, Sendable {
        var title: String
        var notes: String
        var dueDate: Date?
        var isCompleted: Bool
    }

    enum ImportError: LocalizedError {
        case denied
        case restricted
        case fetchFailed(Error)

        var errorDescription: String? {
            switch self {
            case .denied:
                "Reminders access was denied. Open System Settings → Privacy & Security → Reminders to grant access, then try again."
            case .restricted:
                "Reminders access is restricted on this Mac (parental controls or MDM)."
            case .fetchFailed(let err):
                "Couldn't read Reminders: \(err.localizedDescription)"
            }
        }
    }

    func requestAccessAndFetch() async throws -> [ImportedList] {
        let store = EKEventStore()
        let authorized: Bool
        if #available(macOS 14.0, *) {
            authorized = try await store.requestFullAccessToReminders()
        } else {
            authorized = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
                store.requestAccess(to: .reminder) { granted, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: granted) }
                }
            }
        }
        guard authorized else { throw ImportError.denied }

        let calendars = store.calendars(for: .reminder)
        guard calendars.isEmpty == false else { return [] }

        let predicate = store.predicateForReminders(in: calendars)
        let reminders: [EKReminder] = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[EKReminder], Error>) in
            store.fetchReminders(matching: predicate) { items in
                continuation.resume(returning: items ?? [])
            }
        }

        var grouped: [String: [ImportedReminder]] = [:]
        for reminder in reminders {
            let listName = reminder.calendar?.title ?? "Imported"
            let dueDate: Date? = reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) }
            let item = ImportedReminder(
                title: reminder.title ?? "(untitled)",
                notes: reminder.notes ?? "",
                dueDate: dueDate,
                isCompleted: reminder.isCompleted
            )
            grouped[listName, default: []].append(item)
        }

        return grouped
            .map { ImportedList(name: $0.key, reminders: $0.value) }
            .sorted { $0.name < $1.name }
    }
}
