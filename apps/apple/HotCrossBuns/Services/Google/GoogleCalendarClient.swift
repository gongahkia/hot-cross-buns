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
        let baseQueryItems = [
            URLQueryItem(name: "singleEvents", value: "true"),
            URLQueryItem(name: "showDeleted", value: "true"),
            URLQueryItem(name: "maxResults", value: "250")
        ]
        var pageToken: String?
        var events: [CalendarEventMirror] = []
        var nextSyncToken: String?

        repeat {
            var queryItems = baseQueryItems

            if let syncToken, !syncToken.isEmpty {
                queryItems.append(URLQueryItem(name: "syncToken", value: syncToken))
            } else {
                queryItems.append(URLQueryItem(name: "timeMin", value: ISO8601DateFormatter.google.string(from: timeMin)))
            }

            if let pageToken {
                queryItems.append(URLQueryItem(name: "pageToken", value: pageToken))
            }

            let response: GoogleEventsResponse = try await transport.get(
                path: "/calendar/v3/calendars/\(encodedCalendarID)/events",
                queryItems: queryItems
            )

            events.append(contentsOf: response.items.map { $0.mirror(calendarID: calendarID) })
            nextSyncToken = response.nextSyncToken ?? nextSyncToken
            pageToken = response.nextPageToken
        } while pageToken != nil

        return GoogleCalendarEventsPage(
            events: events,
            nextSyncToken: nextSyncToken
        )
    }

    func insertEvent(
        calendarID: String,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        reminderMinutes: Int?,
        location: String = "",
        recurrence: [String] = [],
        attendeeEmails: [String] = [],
        sendUpdates: String = "none"
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let requestBody = GoogleEventMutationDTO(
            summary: summary,
            description: details.isEmpty ? nil : details,
            location: location.isEmpty ? nil : location,
            start: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.string(from: startDate) : nil, dateTime: isAllDay ? nil : startDate),
            end: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.exclusiveEndString(from: endDate) : nil, dateTime: isAllDay ? nil : endDate),
            recurrence: recurrence.isEmpty ? nil : recurrence,
            reminders: GoogleEventMutationRemindersDTO.custom(minutes: reminderMinutes),
            attendees: attendeeEmails.isEmpty ? nil : attendeeEmails.map { GoogleEventAttendeeMutationDTO(email: $0) }
        )
        let response: GoogleEventDTO = try await transport.request(
            method: "POST",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events",
            queryItems: [URLQueryItem(name: "sendUpdates", value: sendUpdates)],
            body: requestBody
        )
        return response.mirror(calendarID: calendarID)
    }

    func updateEvent(
        calendarID: String,
        eventID: String,
        summary: String,
        details: String,
        startDate: Date,
        endDate: Date,
        isAllDay: Bool,
        reminderMinutes: Int?,
        location: String = "",
        recurrence: [String] = [],
        attendeeEmails: [String] = [],
        sendUpdates: String = "none",
        ifMatch: String? = nil
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let encodedEventID = eventID.googlePathComponentEncoded
        let requestBody = GoogleEventMutationDTO(
            summary: summary,
            description: details,
            location: location,
            start: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.string(from: startDate) : nil, dateTime: isAllDay ? nil : startDate),
            end: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.exclusiveEndString(from: endDate) : nil, dateTime: isAllDay ? nil : endDate),
            recurrence: recurrence,
            reminders: GoogleEventMutationRemindersDTO.custom(minutes: reminderMinutes),
            attendees: attendeeEmails.map { GoogleEventAttendeeMutationDTO(email: $0) }
        )
        let response: GoogleEventDTO = try await transport.request(
            method: "PATCH",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events/\(encodedEventID)",
            queryItems: [URLQueryItem(name: "sendUpdates", value: sendUpdates)],
            body: requestBody,
            ifMatch: ifMatch
        )
        return response.mirror(calendarID: calendarID)
    }

    func moveEvent(
        calendarID: String,
        eventID: String,
        destinationCalendarID: String
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let encodedEventID = eventID.googlePathComponentEncoded
        let response: GoogleEventDTO = try await transport.request(
            method: "POST",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events/\(encodedEventID)/move",
            queryItems: [
                URLQueryItem(name: "destination", value: destinationCalendarID),
                URLQueryItem(name: "sendUpdates", value: "none")
            ]
        )
        return response.mirror(calendarID: destinationCalendarID)
    }

    func deleteEvent(calendarID: String, eventID: String, ifMatch: String? = nil) async throws {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let encodedEventID = eventID.googlePathComponentEncoded
        try await transport.send(
            method: "DELETE",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events/\(encodedEventID)",
            queryItems: [URLQueryItem(name: "sendUpdates", value: "none")],
            ifMatch: ifMatch
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
    var nextPageToken: String?
    var nextSyncToken: String?
}

private struct GoogleEventDTO: Decodable, Sendable {
    var id: String
    var summary: String?
    var description: String?
    var location: String?
    var status: String?
    var start: GoogleEventDateDTO?
    var end: GoogleEventDateDTO?
    var recurrence: [String]?
    var reminders: GoogleEventRemindersDTO?
    var attendees: [GoogleEventAttendeeDTO]?
    var etag: String?
    var updated: Date?

    func mirror(calendarID: String) -> CalendarEventMirror {
        let fallbackDate = updated ?? Date()
        return CalendarEventMirror(
            id: id,
            calendarID: calendarID,
            summary: summary ?? "Untitled event",
            details: description ?? "",
            startDate: start?.resolvedDate ?? fallbackDate,
            endDate: end?.resolvedDate ?? fallbackDate,
            isAllDay: start?.date != nil,
            status: CalendarEventStatus(rawValue: status ?? "confirmed") ?? .confirmed,
            recurrence: recurrence ?? [],
            etag: etag,
            updatedAt: updated,
            reminderMinutes: reminders?.customPopupMinutes ?? [],
            location: location ?? "",
            attendeeEmails: attendees?.compactMap(\.email) ?? []
        )
    }
}

private struct GoogleEventAttendeeDTO: Codable, Sendable {
    var email: String?
    var displayName: String?
    var responseStatus: String?
}

private struct GoogleEventDateDTO: Decodable, Sendable {
    var date: Date?
    var dateTime: Date?

    var resolvedDate: Date {
        dateTime ?? date ?? Date()
    }
}

private struct GoogleEventRemindersDTO: Decodable, Sendable {
    var useDefault: Bool?
    var overrides: [GoogleEventReminderDTO]?

    var customPopupMinutes: [Int] {
        guard useDefault == false else {
            return []
        }

        return overrides?
            .filter { $0.method == "popup" }
            .map(\.minutes)
            .sorted() ?? []
    }
}

private struct GoogleEventReminderDTO: Decodable, Sendable {
    var method: String
    var minutes: Int
}

private struct GoogleEventMutationDTO: Encodable, Sendable {
    var summary: String
    var description: String?
    var location: String?
    var start: GoogleEventMutationDateDTO
    var end: GoogleEventMutationDateDTO
    var recurrence: [String]?
    var reminders: GoogleEventMutationRemindersDTO?
    var attendees: [GoogleEventAttendeeMutationDTO]?
}

private struct GoogleEventAttendeeMutationDTO: Encodable, Sendable {
    var email: String
}

private struct GoogleEventMutationDateDTO: Encodable, Sendable {
    var date: String?
    var dateTime: Date?
}

private struct GoogleEventMutationRemindersDTO: Encodable, Sendable {
    var useDefault: Bool
    var overrides: [GoogleEventMutationReminderDTO]?

    static func custom(minutes: Int?) -> GoogleEventMutationRemindersDTO? {
        guard let minutes else {
            return nil
        }

        return GoogleEventMutationRemindersDTO(
            useDefault: false,
            overrides: [GoogleEventMutationReminderDTO(method: "popup", minutes: minutes)]
        )
    }
}

private struct GoogleEventMutationReminderDTO: Encodable, Sendable {
    var method: String
    var minutes: Int
}

private enum GoogleDateOnlyFormatter {
    static let calendar = Calendar(identifier: .gregorian)

    static func string(from date: Date) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year, let month = components.month, let day = components.day else {
            return "1970-01-01"
        }

        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func exclusiveEndString(from inclusiveEndDate: Date) -> String {
        let nextDay = calendar.date(byAdding: .day, value: 1, to: inclusiveEndDate) ?? inclusiveEndDate
        return string(from: nextDay)
    }
}

private extension String {
    var googlePathComponentEncoded: String {
        var allowedCharacters = CharacterSet.urlPathAllowed
        allowedCharacters.remove(charactersIn: "/?#")
        return addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? self
    }
}
