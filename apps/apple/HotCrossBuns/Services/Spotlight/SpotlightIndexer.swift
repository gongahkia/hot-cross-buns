@preconcurrency import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

actor SpotlightIndexer {
    static let taskDomain = "com.gongahkia.hotcrossbuns.tasks"
    static let eventDomain = "com.gongahkia.hotcrossbuns.events"
    static let taskURLScheme = "hotcrossbuns://task/"
    static let eventURLScheme = "hotcrossbuns://event/"

    private let index: CSSearchableIndex

    init(index: CSSearchableIndex = .default()) {
        self.index = index
    }

    func update(tasks: [TaskMirror], events: [CalendarEventMirror]) async {
        let taskItems = tasks
            .filter { $0.isDeleted == false }
            .map(taskItem)
        let eventItems = events
            .filter { $0.status != .cancelled }
            .map(eventItem)

        do {
            try await replace(items: taskItems, in: Self.taskDomain)
            try await replace(items: eventItems, in: Self.eventDomain)
        } catch {
            // Spotlight is best-effort; ignore indexing failures rather than surface to the user.
        }
    }

    func removeAll() async {
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                index.deleteSearchableItems(withDomainIdentifiers: [Self.taskDomain, Self.eventDomain]) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
        } catch {
            // best effort
        }
    }

    private func replace(items: [CSSearchableItem], in domain: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            index.deleteSearchableItems(withDomainIdentifiers: [domain]) { error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard items.isEmpty == false else {
                    continuation.resume()
                    return
                }
                self.index.indexSearchableItems(items) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
        }
    }

    nonisolated private func taskItem(_ task: TaskMirror) -> CSSearchableItem {
        let attrs = CSSearchableItemAttributeSet(contentType: UTType.text)
        attrs.title = task.title
        attrs.contentDescription = task.notes.isEmpty ? nil : task.notes
        attrs.dueDate = task.dueDate
        attrs.displayName = task.title
        attrs.keywords = ["task", task.status.rawValue]
        attrs.contentURL = URL(string: Self.taskURLScheme + task.id)

        return CSSearchableItem(
            uniqueIdentifier: Self.taskURLScheme + task.id,
            domainIdentifier: Self.taskDomain,
            attributeSet: attrs
        )
    }

    nonisolated private func eventItem(_ event: CalendarEventMirror) -> CSSearchableItem {
        let attrs = CSSearchableItemAttributeSet(contentType: UTType.calendarEvent)
        attrs.title = event.summary
        attrs.contentDescription = event.details.isEmpty ? nil : event.details
        attrs.startDate = event.startDate
        attrs.endDate = event.endDate
        attrs.allDay = event.isAllDay as NSNumber
        attrs.displayName = event.summary
        attrs.keywords = ["event", event.status.rawValue]
        attrs.contentURL = URL(string: Self.eventURLScheme + event.id)

        return CSSearchableItem(
            uniqueIdentifier: Self.eventURLScheme + event.id,
            domainIdentifier: Self.eventDomain,
            attributeSet: attrs
        )
    }
}

enum SpotlightIdentifier {
    case task(String)
    case event(String)

    init?(uniqueIdentifier: String) {
        if uniqueIdentifier.hasPrefix(SpotlightIndexer.taskURLScheme) {
            let id = String(uniqueIdentifier.dropFirst(SpotlightIndexer.taskURLScheme.count))
            self = .task(id)
        } else if uniqueIdentifier.hasPrefix(SpotlightIndexer.eventURLScheme) {
            let id = String(uniqueIdentifier.dropFirst(SpotlightIndexer.eventURLScheme.count))
            self = .event(id)
        } else {
            return nil
        }
    }
}
