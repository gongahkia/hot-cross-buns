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
        attrs.textContent = Self.taskTextContent(task)
        attrs.dueDate = task.dueDate
        attrs.displayName = task.title
        attrs.keywords = ["task", task.status.rawValue]
        attrs.contentURL = URL(string: Self.taskURLScheme + task.id)
        attrs.contentModificationDate = task.updatedAt
        attrs.metadataModificationDate = task.updatedAt

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
        attrs.textContent = Self.eventTextContent(event)
        attrs.startDate = event.startDate
        attrs.endDate = event.endDate
        attrs.allDay = event.isAllDay as NSNumber
        attrs.displayName = event.summary
        attrs.keywords = eventKeywords(for: event)
        attrs.contentURL = URL(string: Self.eventURLScheme + event.id)
        attrs.contentModificationDate = event.updatedAt
        attrs.metadataModificationDate = event.updatedAt
        if event.location.isEmpty == false {
            attrs.namedLocation = event.location
        }
        if event.attendeeEmails.isEmpty == false {
            attrs.recipientEmailAddresses = event.attendeeEmails
        }

        return CSSearchableItem(
            uniqueIdentifier: Self.eventURLScheme + event.id,
            domainIdentifier: Self.eventDomain,
            attributeSet: attrs
        )
    }

    nonisolated private func eventKeywords(for event: CalendarEventMirror) -> [String] {
        var keywords = ["event", event.status.rawValue]
        if event.meetLink.isEmpty == false { keywords.append("meet") }
        if event.attendeeEmails.isEmpty == false { keywords.append("meeting") }
        if event.isAllDay { keywords.append("all-day") }
        return keywords
    }

    // Spotlight shows the inline preview (cmd-space → space) using
    // textContent. Assembling a rich single-blurb here gives users the
    // full "who / when / where / link" summary without leaving Spotlight.
    nonisolated static func taskTextContent(_ task: TaskMirror) -> String {
        var parts: [String] = []
        if let due = task.dueDate {
            parts.append("Due \(due.formatted(date: .abbreviated, time: .omitted))")
        }
        if task.isCompleted {
            parts.append("Completed")
        }
        if task.notes.isEmpty == false {
            parts.append(task.notes)
        }
        return parts.joined(separator: "\n")
    }

    nonisolated static func eventTextContent(_ event: CalendarEventMirror) -> String {
        var parts: [String] = []
        let timeLabel: String
        if event.isAllDay {
            let inclusiveEnd = Calendar.current.date(byAdding: .day, value: -1, to: event.endDate) ?? event.endDate
            let startString = event.startDate.formatted(date: .abbreviated, time: .omitted)
            let endString = inclusiveEnd.formatted(date: .abbreviated, time: .omitted)
            timeLabel = startString == endString ? "All day · \(startString)" : "All day · \(startString) – \(endString)"
        } else {
            let startString = event.startDate.formatted(date: .abbreviated, time: .shortened)
            let endString = event.endDate.formatted(date: .omitted, time: .shortened)
            timeLabel = "\(startString) – \(endString)"
        }
        parts.append(timeLabel)
        if event.location.isEmpty == false {
            parts.append("📍 \(event.location)")
        }
        if event.meetLink.isEmpty == false {
            parts.append("📹 \(event.meetLink)")
        }
        if event.attendeeEmails.isEmpty == false {
            parts.append("👥 \(event.attendeeEmails.joined(separator: ", "))")
        }
        if event.details.isEmpty == false {
            parts.append(event.details)
        }
        return parts.joined(separator: "\n")
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
