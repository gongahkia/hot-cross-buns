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

    func listEvents(calendarID: String, syncToken: String?, timeMin: Date = Date()) async throws -> GoogleCalendarEventsPage {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        var queryItems = [
            URLQueryItem(name: "singleEvents", value: "true"),
            URLQueryItem(name: "showDeleted", value: "true"),
            URLQueryItem(name: "maxResults", value: "250")
        ]

        if let syncToken, !syncToken.isEmpty {
            queryItems.append(URLQueryItem(name: "syncToken", value: syncToken))
        } else {
            queryItems.append(URLQueryItem(name: "timeMin", value: ISO8601DateFormatter.google.string(from: timeMin)))
        }

        let response: GoogleEventsResponse = try await transport.get(
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events",
            queryItems: queryItems
        )

        return GoogleCalendarEventsPage(
            events: response.items.map { $0.mirror(calendarID: calendarID) },
            nextSyncToken: response.nextSyncToken
        )
    }

    func insertEvent(
        calendarID: String,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let requestBody = GoogleEventMutationDTO(
            summary: summary,
            description: details.isEmpty ? nil : details,
            start: GoogleEventMutationDateDTO(dateTime: startDate),
            end: GoogleEventMutationDateDTO(dateTime: endDate)
        )
        let response: GoogleEventDTO = try await transport.request(
            method: "POST",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events",
            body: requestBody
        )
        return response.mirror(calendarID: calendarID)
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

    func mirror(calendarID: String) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id,
            calendarID: calendarID,
            summary: summary ?? "Untitled event",
            details: description ?? "",
            startDate: start.resolvedDate,
            endDate: end.resolvedDate,
            isAllDay: start.date != nil,
            status: CalendarEventStatus(rawValue: status ?? "confirmed") ?? .confirmed,
            recurrence: recurrence ?? [],
            etag: etag,
            updatedAt: updated
        )
    }
}

private struct GoogleEventDateDTO: Decodable, Sendable {
    var date: Date?
    var dateTime: Date?

    var resolvedDate: Date {
        dateTime ?? date ?? Date()
    }
}

private struct GoogleEventMutationDTO: Encodable, Sendable {
    var summary: String
    var description: String?
    var start: GoogleEventMutationDateDTO
    var end: GoogleEventMutationDateDTO
}

private struct GoogleEventMutationDateDTO: Encodable, Sendable {
    var dateTime: Date
}

private extension String {
    var googlePathComponentEncoded: String {
        var allowedCharacters = CharacterSet.urlPathAllowed
        allowedCharacters.remove(charactersIn: "/?#")
        return addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? self
    }
}
