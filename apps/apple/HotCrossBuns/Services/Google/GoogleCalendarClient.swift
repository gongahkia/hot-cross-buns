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
        sendUpdates: String = "none",
        addGoogleMeet: Bool = false,
        colorId: String? = nil
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let htmlDetails = MarkdownHTML.markdownToCalendarHTML(details)
        let conference = addGoogleMeet
            ? GoogleConferenceCreateDTO(
                createRequest: GoogleConferenceCreateRequestDTO(
                    requestId: UUID().uuidString,
                    conferenceSolutionKey: GoogleConferenceSolutionKeyEncodeDTO(type: "hangoutsMeet")
                )
            )
            : nil
        let requestBody = GoogleEventMutationDTO(
            summary: summary,
            description: htmlDetails.isEmpty ? nil : htmlDetails,
            location: location.isEmpty ? nil : location,
            start: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.string(from: startDate) : nil, dateTime: isAllDay ? nil : startDate),
            end: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.exclusiveEndString(from: endDate) : nil, dateTime: isAllDay ? nil : endDate),
            recurrence: recurrence.isEmpty ? nil : recurrence,
            reminders: GoogleEventMutationRemindersDTO.custom(minutes: reminderMinutes),
            attendees: attendeeEmails.isEmpty ? nil : attendeeEmails.map { GoogleEventAttendeeMutationDTO(email: $0) },
            conferenceData: conference,
            colorId: colorId
        )
        var queryItems: [URLQueryItem] = [URLQueryItem(name: "sendUpdates", value: sendUpdates)]
        if addGoogleMeet {
            // conferenceDataVersion=1 is required for Google to honour a
            // createRequest and materialize the Meet link server-side.
            queryItems.append(URLQueryItem(name: "conferenceDataVersion", value: "1"))
        }
        let response: GoogleEventDTO = try await transport.request(
            method: "POST",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events",
            queryItems: queryItems,
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
        addGoogleMeet: Bool = false,
        colorId: String? = nil,
        ifMatch: String? = nil
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let encodedEventID = eventID.googlePathComponentEncoded
        let htmlDetails = MarkdownHTML.markdownToCalendarHTML(details)
        let conference = addGoogleMeet
            ? GoogleConferenceCreateDTO(
                createRequest: GoogleConferenceCreateRequestDTO(
                    requestId: UUID().uuidString,
                    conferenceSolutionKey: GoogleConferenceSolutionKeyEncodeDTO(type: "hangoutsMeet")
                )
            )
            : nil
        let requestBody = GoogleEventMutationDTO(
            summary: summary,
            description: htmlDetails,
            location: location,
            start: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.string(from: startDate) : nil, dateTime: isAllDay ? nil : startDate),
            end: GoogleEventMutationDateDTO(date: isAllDay ? GoogleDateOnlyFormatter.exclusiveEndString(from: endDate) : nil, dateTime: isAllDay ? nil : endDate),
            recurrence: recurrence,
            reminders: GoogleEventMutationRemindersDTO.custom(minutes: reminderMinutes),
            attendees: attendeeEmails.map { GoogleEventAttendeeMutationDTO(email: $0) },
            conferenceData: conference,
            colorId: colorId
        )
        var queryItems: [URLQueryItem] = [URLQueryItem(name: "sendUpdates", value: sendUpdates)]
        if addGoogleMeet {
            queryItems.append(URLQueryItem(name: "conferenceDataVersion", value: "1"))
        }
        let response: GoogleEventDTO = try await transport.request(
            method: "PATCH",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events/\(encodedEventID)",
            queryItems: queryItems,
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

    // Fetches a single event by id — used when we need the master event's
    // current recurrence rules for "this and following" truncation, since
    // instances returned via singleEvents=true don't carry the master RRULE.
    func getEvent(calendarID: String, eventID: String) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let encodedEventID = eventID.googlePathComponentEncoded
        let response: GoogleEventDTO = try await transport.request(
            method: "GET",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events/\(encodedEventID)"
        )
        return response.mirror(calendarID: calendarID)
    }

    // Patches only the recurrence array on the master event. Used by the
    // "this and following" flow, which rewrites the master's RRULE with a
    // new UNTIL clause and leaves all other fields untouched.
    func patchEventRecurrence(
        calendarID: String,
        eventID: String,
        recurrence: [String],
        ifMatch: String? = nil
    ) async throws -> CalendarEventMirror {
        let encodedCalendarID = calendarID.googlePathComponentEncoded
        let encodedEventID = eventID.googlePathComponentEncoded
        struct RecurrencePatch: Encodable { var recurrence: [String] }
        let response: GoogleEventDTO = try await transport.request(
            method: "PATCH",
            path: "/calendar/v3/calendars/\(encodedCalendarID)/events/\(encodedEventID)",
            body: RecurrencePatch(recurrence: recurrence),
            ifMatch: ifMatch
        )
        return response.mirror(calendarID: calendarID)
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
    var conferenceData: GoogleConferenceDataDTO?
    var colorId: String?

    func mirror(calendarID: String) -> CalendarEventMirror {
        let fallbackDate = updated ?? Date()
        let renderedDetails: String
        if let description, description.isEmpty == false {
            renderedDetails = MarkdownHTML.calendarHTMLToMarkdown(description)
        } else {
            renderedDetails = ""
        }
        // Google Calendar returns `date` (for all-day) as "yyyy-MM-dd" decoded
        // by GoogleDateParser.dateOnly as UTC midnight. Comparing that against
        // a local-TZ reference date is unsafe: in UTC-N an event whose date is
        // "2026-04-19" decodes to April 18 8pm local and appears as April 18
        // in all snapshot/forecast filters. Re-anchor date-only values to the
        // user's local midnight of the same Y/M/D so every downstream
        // comparison uses matching timezones.
        let isAllDay = start?.date != nil
        let startDate = GoogleEventDTO.resolveDate(
            dateTime: start?.dateTime,
            dateOnly: start?.date,
            fallback: fallbackDate
        )
        let endDate = GoogleEventDTO.resolveDate(
            dateTime: end?.dateTime,
            dateOnly: end?.date,
            fallback: fallbackDate
        )
        let attendeeList = attendees ?? []
        let attendeeResponses: [CalendarEventAttendee] = attendeeList.compactMap { dto in
            guard let email = dto.email, email.isEmpty == false else { return nil }
            return CalendarEventAttendee(
                email: email,
                displayName: dto.displayName,
                responseStatus: AttendeeResponseStatus(wire: dto.responseStatus)
            )
        }
        return CalendarEventMirror(
            id: id,
            calendarID: calendarID,
            summary: summary ?? "Untitled event",
            details: renderedDetails,
            startDate: startDate,
            endDate: endDate,
            isAllDay: isAllDay,
            status: CalendarEventStatus(rawValue: status ?? "confirmed") ?? .confirmed,
            recurrence: recurrence ?? [],
            etag: etag,
            updatedAt: updated,
            reminderMinutes: reminders?.customPopupMinutes ?? [],
            location: location ?? "",
            attendeeEmails: attendeeList.compactMap(\.email),
            attendeeResponses: attendeeResponses,
            meetLink: conferenceData?.meetLink ?? "",
            colorId: colorId
        )
    }

    fileprivate static func resolveDate(dateTime: Date?, dateOnly: Date?, fallback: Date) -> Date {
        if let dateTime {
            return dateTime
        }
        guard let dateOnly else { return fallback }
        // Re-extract Y/M/D from the UTC-anchored decoded date, then rebuild
        // at local midnight of the same calendar day.
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        let comps = utcCalendar.dateComponents([.year, .month, .day], from: dateOnly)
        var localComps = DateComponents()
        localComps.year = comps.year
        localComps.month = comps.month
        localComps.day = comps.day
        return Calendar.current.date(from: localComps) ?? fallback
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

private struct GoogleConferenceDataDTO: Decodable, Sendable {
    var conferenceId: String?
    var entryPoints: [GoogleConferenceEntryPointDTO]?
    var conferenceSolution: GoogleConferenceSolutionDTO?

    var meetLink: String {
        guard let video = entryPoints?.first(where: { $0.entryPointType == "video" }) else {
            return ""
        }
        return video.uri ?? ""
    }
}

private struct GoogleConferenceEntryPointDTO: Decodable, Sendable {
    var entryPointType: String?
    var uri: String?
    var label: String?
}

private struct GoogleConferenceSolutionDTO: Decodable, Sendable {
    var key: GoogleConferenceSolutionKeyDTO?
    var name: String?
}

private struct GoogleConferenceSolutionKeyDTO: Decodable, Sendable {
    var type: String?
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
    var conferenceData: GoogleConferenceCreateDTO?
    var colorId: String?

    enum CodingKeys: String, CodingKey {
        case summary, description, location, start, end
        case recurrence, reminders, attendees, conferenceData, colorId
    }

    // Custom encoding so nil optionals are omitted rather than emitted as
    // `null`. On a PATCH, Google Calendar treats explicit null as "clear this
    // field" — accidental clearing of conferenceData or colorId on every
    // update would be destructive.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(summary, forKey: .summary)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(location, forKey: .location)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
        try container.encodeIfPresent(recurrence, forKey: .recurrence)
        try container.encodeIfPresent(reminders, forKey: .reminders)
        try container.encodeIfPresent(attendees, forKey: .attendees)
        try container.encodeIfPresent(conferenceData, forKey: .conferenceData)
        try container.encodeIfPresent(colorId, forKey: .colorId)
    }
}

private struct GoogleConferenceCreateDTO: Encodable, Sendable {
    var createRequest: GoogleConferenceCreateRequestDTO
}

private struct GoogleConferenceCreateRequestDTO: Encodable, Sendable {
    var requestId: String
    var conferenceSolutionKey: GoogleConferenceSolutionKeyEncodeDTO
}

private struct GoogleConferenceSolutionKeyEncodeDTO: Encodable, Sendable {
    var type: String
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
