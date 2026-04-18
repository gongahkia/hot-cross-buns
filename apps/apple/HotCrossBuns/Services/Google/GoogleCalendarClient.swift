import Foundation

struct GoogleCalendarClient: Sendable {
    private let transport: GoogleAPITransport

    init(transport: GoogleAPITransport) {
        self.transport = transport
    }

    func listCalendars() async throws -> [CalendarListMirror] {
        let response: GoogleCalendarListResponse = try await transport.get(path: "/calendar/v3/users/me/calendarList")
        return response.items.map { item in
            CalendarListMirror(
                id: item.id,
                summary: item.summary,
                colorHex: item.backgroundColor ?? "#F66B3D",
                isSelected: item.selected ?? true,
                accessRole: item.accessRole,
                etag: item.etag
            )
        }
    }

    func listEvents(calendarID: String, syncToken: String?) async throws -> GoogleCalendarEventsPage {
        var queryItems = [
            URLQueryItem(name: "singleEvents", value: "true"),
            URLQueryItem(name: "showDeleted", value: "true"),
            URLQueryItem(name: "maxResults", value: "250")
        ]

        if let syncToken, !syncToken.isEmpty {
            queryItems.append(URLQueryItem(name: "syncToken", value: syncToken))
        } else {
            queryItems.append(URLQueryItem(name: "timeMin", value: ISO8601DateFormatter.google.string(from: Date())))
        }

        let response: GoogleEventsResponse = try await transport.get(
            path: "/calendar/v3/calendars/\(calendarID)/events",
            queryItems: queryItems
        )

        return GoogleCalendarEventsPage(
            events: response.items.map { item in
                CalendarEventMirror(
                    id: item.id,
                    calendarID: calendarID,
                    summary: item.summary ?? "Untitled event",
                    details: item.description ?? "",
                    startDate: item.start.resolvedDate,
                    endDate: item.end.resolvedDate,
                    isAllDay: item.start.date != nil,
                    status: CalendarEventStatus(rawValue: item.status ?? "confirmed") ?? .confirmed,
                    recurrence: item.recurrence ?? [],
                    etag: item.etag,
                    updatedAt: item.updated
                )
            },
            nextSyncToken: response.nextSyncToken
        )
    }
}

struct GoogleCalendarEventsPage: Sendable {
    var events: [CalendarEventMirror]
    var nextSyncToken: String?
}

private struct GoogleCalendarListResponse: Decodable, Sendable {
    var items: [GoogleCalendarListItemDTO]
}

private struct GoogleCalendarListItemDTO: Decodable, Sendable {
    var id: String
    var summary: String
    var backgroundColor: String?
    var selected: Bool?
    var accessRole: String
    var etag: String?
}

private struct GoogleEventsResponse: Decodable, Sendable {
    var items: [GoogleEventDTO]
    var nextSyncToken: String?
}

private struct GoogleEventDTO: Decodable, Sendable {
    var id: String
    var summary: String?
    var description: String?
    var status: String?
    var start: GoogleEventDateDTO
    var end: GoogleEventDateDTO
    var recurrence: [String]?
    var etag: String?
    var updated: Date?
}

private struct GoogleEventDateDTO: Decodable, Sendable {
    var date: Date?
    var dateTime: Date?

    var resolvedDate: Date {
        dateTime ?? date ?? Date()
    }
}
