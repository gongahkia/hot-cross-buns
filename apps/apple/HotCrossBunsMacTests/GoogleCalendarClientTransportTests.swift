import Foundation
import XCTest
@testable import HotCrossBunsMac

final class GoogleCalendarClientTransportTests: XCTestCase {
    private var client: GoogleCalendarClient!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        let transport = GoogleAPITransport(
            baseURL: URL(string: "https://www.googleapis.com")!,
            tokenProvider: StaticAccessTokenProvider(token: "test-token"),
            urlSession: MockURLProtocol.testSession()
        )
        client = GoogleCalendarClient(transport: transport)
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    func testListCalendarsMapsPopupRemindersOnly() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/calendar/v3/users/me/calendarList")
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = #"""
            {
              "items": [
                {
                  "id": "primary",
                  "summary": "Primary",
                  "backgroundColor": "#123456",
                  "selected": true,
                  "accessRole": "owner",
                  "etag": "calendar-etag",
                  "defaultReminders": [
                    { "method": "email", "minutes": 120 },
                    { "method": "popup", "minutes": 30 },
                    { "method": "popup", "minutes": 10 }
                  ]
                }
              ]
            }
            """#
            return (response, Data(body.utf8))
        }

        let calendars = try await client.listCalendars()
        XCTAssertEqual(calendars.count, 1)
        XCTAssertEqual(calendars[0].id, "primary")
        XCTAssertEqual(calendars[0].summary, "Primary")
        XCTAssertEqual(calendars[0].colorHex, "#123456")
        XCTAssertEqual(calendars[0].defaultReminderMinutes, [10, 30])
    }

    func testListEventsPaginatesAndCarriesSyncToken() async throws {
        var requestCount = 0
        MockURLProtocol.requestHandler = { request in
            requestCount += 1
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.path,
                "/calendar/v3/calendars/team@example.com/events"
            )
            let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(query["singleEvents"], "true")
            XCTAssertEqual(query["showDeleted"], "true")
            XCTAssertEqual(query["maxResults"], "2500")
            XCTAssertEqual(query["syncToken"], "sync-123")
            XCTAssertNil(query["timeMin"])
            if requestCount == 1 {
                XCTAssertNil(query["pageToken"])
            } else {
                XCTAssertEqual(query["pageToken"], "page-2")
            }

            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body: String
            if requestCount == 1 {
                body = #"""
                {
                  "items": [
                    {
                      "id": "evt-1",
                      "summary": "First",
                      "status": "confirmed",
                      "start": { "dateTime": "2026-04-24T09:00:00Z" },
                      "end": { "dateTime": "2026-04-24T10:00:00Z" }
                    }
                  ],
                  "nextPageToken": "page-2"
                }
                """#
            } else {
                body = #"""
                {
                  "items": [
                    {
                      "id": "evt-2",
                      "summary": "Second",
                      "status": "confirmed",
                      "description": "Linked task: Task title\nhcb://task/task-123",
                      "start": { "date": "2026-04-25" },
                      "end": { "date": "2026-04-26" }
                    }
                  ],
                  "nextSyncToken": "sync-next"
                }
                """#
            }
            return (response, Data(body.utf8))
        }

        let page = try await client.listEvents(calendarID: "team@example.com", syncToken: "sync-123")
        XCTAssertEqual(requestCount, 2)
        XCTAssertEqual(page.events.map(\.id), ["evt-1", "evt-2"])
        XCTAssertEqual(page.nextSyncToken, "sync-next")
        XCTAssertFalse(page.events[0].isAllDay)
        XCTAssertTrue(page.events[1].isAllDay)
        XCTAssertEqual(page.events[1].hcbTaskID, "task-123")
        XCTAssertEqual(page.events[1].details, "")
    }

    func testListEventsUsesTimeMinForFullSync() async throws {
        let timeMin = Date(timeIntervalSince1970: 1_713_900_000)
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let queryItems = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let query = Dictionary(uniqueKeysWithValues: queryItems.map { ($0.name, $0.value ?? "") })
            XCTAssertNil(query["syncToken"])
            XCTAssertEqual(query["timeMin"], ISO8601DateFormatter.google.string(from: timeMin))
            return (response, Data(#"{"items":[],"nextSyncToken":"full-sync"}"#.utf8))
        }

        let page = try await client.listEvents(calendarID: "primary", syncToken: nil, timeMin: timeMin)
        XCTAssertEqual(page.events.count, 0)
        XCTAssertEqual(page.nextSyncToken, "full-sync")
    }

    func testInsertEventPostsConferenceReminderAttendeesAndExtendedProperties() async throws {
        var capturedBody = ""
        MockURLProtocol.requestHandler = { request in
            capturedBody = Self.requestBodyString(from: request)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = #"""
            {
              "id": "srv-1",
              "summary": "Planning",
              "description": "line one<br>line two",
              "location": "Room 1",
              "status": "confirmed",
              "start": { "dateTime": "2026-05-01T09:00:00Z" },
              "end": { "dateTime": "2026-05-01T10:00:00Z" },
              "reminders": {
                "useDefault": false,
                "overrides": [{ "method": "popup", "minutes": 30 }]
              },
              "attendees": [
                { "email": "alice@example.com", "responseStatus": "accepted" },
                { "email": "bob@example.com", "responseStatus": "tentative" }
              ],
              "conferenceData": {
                "entryPoints": [
                  { "entryPointType": "video", "uri": "https://meet.google.com/abc-defg-hij" }
                ]
              },
              "colorId": "11",
              "extendedProperties": {
                "private": { "hcbTaskID": "task-9" }
              }
            }
            """#
            return (response, Data(body.utf8))
        }

        let start = Date(timeIntervalSince1970: 1_714_553_200)
        let end = start.addingTimeInterval(3600)
        let event = try await client.insertEvent(
            calendarID: "primary",
            summary: "Planning",
            details: "line one\nline two",
            startDate: start,
            endDate: end,
            isAllDay: false,
            reminderMinutes: 30,
            location: "Room 1",
            recurrence: ["RRULE:FREQ=WEEKLY"],
            attendeeEmails: ["alice@example.com", "bob@example.com"],
            sendUpdates: "externalOnly",
            addGoogleMeet: true,
            colorId: "11",
            hcbTaskID: "task-9"
        )

        let captured = try XCTUnwrap(MockURLProtocol.capturedRequests.first)
        XCTAssertEqual(captured.httpMethod, "POST")
        XCTAssertEqual(captured.url?.path, "/calendar/v3/calendars/primary/events")
        let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: captured.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(query["sendUpdates"], "externalOnly")
        XCTAssertEqual(query["conferenceDataVersion"], "1")
        XCTAssertEqual(captured.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
        XCTAssertTrue(capturedBody.contains(#""summary":"Planning""#))
        XCTAssertTrue(capturedBody.contains(#""description":"line one<br>line two""#))
        XCTAssertTrue(capturedBody.contains(#""location":"Room 1""#))
        XCTAssertTrue(capturedBody.contains(#""recurrence":["RRULE:FREQ=WEEKLY"]"#))
        XCTAssertTrue(capturedBody.contains(#""minutes":30"#))
        XCTAssertTrue(capturedBody.contains(#""email":"alice@example.com""#))
        XCTAssertTrue(capturedBody.contains(#""email":"bob@example.com""#))
        XCTAssertTrue(capturedBody.contains(#""conferenceData":{"createRequest":"#))
        XCTAssertTrue(capturedBody.contains(#""colorId":"11""#))
        XCTAssertTrue(capturedBody.contains(#""extendedProperties":{"private":{"hcbTaskID":"task-9"}}"#))
        XCTAssertEqual(event.meetLink, "https://meet.google.com/abc-defg-hij")
        XCTAssertEqual(event.hcbTaskID, "task-9")
        XCTAssertEqual(event.reminderMinutes, [30])
        XCTAssertEqual(event.attendeeEmails, ["alice@example.com", "bob@example.com"])
    }

    func testUpdateEventSendsIfMatchAndOmitsNilOptionalFields() async throws {
        var capturedBody = ""
        MockURLProtocol.requestHandler = { request in
            capturedBody = Self.requestBodyString(from: request)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let body = #"""
            {
              "id": "srv-2",
              "summary": "Retitled",
              "status": "confirmed",
              "start": { "dateTime": "2026-05-01T11:00:00Z" },
              "end": { "dateTime": "2026-05-01T12:00:00Z" }
            }
            """#
            return (response, Data(body.utf8))
        }

        let start = Date(timeIntervalSince1970: 1_714_560_400)
        let end = start.addingTimeInterval(3600)
        _ = try await client.updateEvent(
            calendarID: "team@example.com",
            eventID: "evt/1",
            summary: "Retitled",
            details: "",
            startDate: start,
            endDate: end,
            isAllDay: false,
            reminderMinutes: nil,
            location: "",
            recurrence: [],
            attendeeEmails: [],
            sendUpdates: "none",
            addGoogleMeet: false,
            colorId: nil,
            hcbTaskID: nil,
            ifMatch: "etag-123"
        )

        let captured = try XCTUnwrap(MockURLProtocol.capturedRequests.first)
        XCTAssertEqual(captured.httpMethod, "PATCH")
        XCTAssertEqual(
            captured.url?.path,
            "/calendar/v3/calendars/team@example.com/events/evt%2F1"
        )
        XCTAssertEqual(captured.value(forHTTPHeaderField: "If-Match"), "etag-123")
        let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: captured.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(query["sendUpdates"], "none")
        XCTAssertNil(query["conferenceDataVersion"])
        XCTAssertFalse(capturedBody.contains(#""conferenceData""#))
        XCTAssertFalse(capturedBody.contains(#""colorId""#))
        XCTAssertFalse(capturedBody.contains(#""extendedProperties""#))
    }

    func testMoveEventUsesDestinationCalendarAndReturnsMovedMirror() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/calendar/v3/calendars/source/events/evt-1/move")
            XCTAssertEqual(query["destination"], "dest")
            XCTAssertEqual(query["sendUpdates"], "none")
            let body = #"""
            {
              "id": "evt-1",
              "summary": "Moved",
              "status": "confirmed",
              "start": { "dateTime": "2026-05-02T09:00:00Z" },
              "end": { "dateTime": "2026-05-02T10:00:00Z" }
            }
            """#
            return (response, Data(body.utf8))
        }

        let moved = try await client.moveEvent(calendarID: "source", eventID: "evt-1", destinationCalendarID: "dest")
        XCTAssertEqual(moved.calendarID, "dest")
        XCTAssertEqual(moved.summary, "Moved")
    }

    func testDeleteAndPatchRecurrenceCarryIfMatch() async throws {
        var requestIndex = 0
        MockURLProtocol.requestHandler = { request in
            requestIndex += 1
            if requestIndex == 1 {
                XCTAssertEqual(request.httpMethod, "PATCH")
                XCTAssertEqual(request.value(forHTTPHeaderField: "If-Match"), "etag-recur")
                XCTAssertEqual(request.url?.path, "/calendar/v3/calendars/primary/events/series-1")
                let body = Self.requestBodyString(from: request)
                XCTAssertEqual(body, #"{"recurrence":["RRULE:FREQ=DAILY"]}"#)
                let response = HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                let json = #"""
                {
                  "id": "series-1",
                  "summary": "Series",
                  "status": "confirmed",
                  "start": { "dateTime": "2026-05-03T09:00:00Z" },
                  "end": { "dateTime": "2026-05-03T10:00:00Z" },
                  "recurrence": ["RRULE:FREQ=DAILY"]
                }
                """#
                return (response, Data(json.utf8))
            } else {
                XCTAssertEqual(request.httpMethod, "DELETE")
                XCTAssertEqual(request.value(forHTTPHeaderField: "If-Match"), "etag-delete")
                XCTAssertEqual(request.url?.path, "/calendar/v3/calendars/primary/events/evt-9")
                let query = Dictionary(uniqueKeysWithValues: (URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
                XCTAssertEqual(query["sendUpdates"], "none")
                let response = HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!
                return (response, Data())
            }
        }

        let patched = try await client.patchEventRecurrence(
            calendarID: "primary",
            eventID: "series-1",
            recurrence: ["RRULE:FREQ=DAILY"],
            ifMatch: "etag-recur"
        )
        XCTAssertEqual(patched.recurrence, ["RRULE:FREQ=DAILY"])

        try await client.deleteEvent(calendarID: "primary", eventID: "evt-9", ifMatch: "etag-delete")
        XCTAssertEqual(requestIndex, 2)
    }

    private static func requestBodyString(from request: URLRequest) -> String {
        if let body = request.httpBody {
            return String(decoding: body, as: UTF8.self)
        }
        if let stream = request.httpBodyStream {
            return read(stream: stream)
        }
        return ""
    }

    private static func read(stream: InputStream) -> String {
        var data = Data()
        stream.open()
        defer { stream.close() }

        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: bufferSize)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }

        return String(decoding: data, as: UTF8.self)
    }
}
