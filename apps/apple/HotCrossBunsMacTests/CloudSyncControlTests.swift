import XCTest
@testable import HotCrossBunsMac

final class CloudSyncControlTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    func testLegacySettingsDefaultToSyncingTasksAndEvents() throws {
        let data = Data(
            """
            {
              "syncMode": "balanced",
              "selectedCalendarIDs": [],
              "selectedTaskListIDs": [],
              "enableLocalNotifications": false
            }
            """.utf8
        )

        let settings = try JSONDecoder().decode(AppSettings.self, from: data)

        XCTAssertEqual(settings.cloudSyncTargets, CloudSyncTarget.all)
    }

    func testCloudSyncTargetsRoundTripTaskOnlyMode() throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.tasks]

        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: data)

        XCTAssertEqual(decoded.cloudSyncTargets, [.tasks])
        XCTAssertTrue(decoded.cloudSyncTargets.syncsTasks)
        XCTAssertFalse(decoded.cloudSyncTargets.syncsEvents)
    }

    func testCloudSyncTargetsMapToResourceTypes() {
        let tasksOnly: Set<CloudSyncTarget> = [.tasks]
        let eventsOnly: Set<CloudSyncTarget> = [.events]

        XCTAssertTrue(tasksOnly.allows(.task))
        XCTAssertTrue(tasksOnly.allows(.taskList))
        XCTAssertFalse(tasksOnly.allows(.event))
        XCTAssertFalse(tasksOnly.allows(.calendar))

        XCTAssertFalse(eventsOnly.allows(.task))
        XCTAssertFalse(eventsOnly.allows(.taskList))
        XCTAssertTrue(eventsOnly.allows(.event))
        XCTAssertTrue(eventsOnly.allows(.calendar))
    }

    func testSchedulerDoesNotTouchNetworkWhenAllCloudTargetsAreDisabled() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = []
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            XCTFail("No request expected, got \(request.url?.absoluteString ?? "<nil>")")
            return Self.jsonResponse(for: request, body: #"{}"#)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertTrue(MockURLProtocol.capturedRequests.isEmpty)
        XCTAssertEqual(synced.taskLists, state.taskLists)
        XCTAssertEqual(synced.tasks, state.tasks)
        XCTAssertEqual(synced.calendars, state.calendars)
        XCTAssertEqual(synced.events, state.events)
        XCTAssertEqual(synced.settings.syncMode, .balanced)
    }

    func testSchedulerLeavesTasksLocalWhenOnlyEventsSync() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.events]
        settings.selectedCalendarIDs = ["cal"]
        settings.hasConfiguredCalendarSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            XCTAssertFalse(path.hasPrefix("/tasks/"), "Tasks endpoints must not be called when Tasks sync is disabled")
            if path == "/calendar/v3/users/me/calendarList" {
                return Self.jsonResponse(for: request, body: Self.calendarListJSON)
            }
            if path == "/calendar/v3/calendars/cal/events" {
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertEqual(synced.taskLists, state.taskLists)
        XCTAssertEqual(synced.tasks, state.tasks)
        XCTAssertEqual(synced.events.map(\.id), ["remote-event"])
        XCTAssertTrue(MockURLProtocol.capturedRequests.allSatisfy { $0.url?.path.hasPrefix("/tasks/") == false })
    }

    func testSchedulerLeavesEventsLocalWhenOnlyTasksSync() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.tasks]
        settings.selectedTaskListIDs = ["list"]
        settings.hasConfiguredTaskListSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            XCTAssertFalse(path.hasPrefix("/calendar/"), "Calendar endpoints must not be called when Events sync is disabled")
            if path == "/tasks/v1/users/@me/lists" {
                return Self.jsonResponse(for: request, body: Self.taskListsJSON)
            }
            if path == "/tasks/v1/lists/list/tasks" {
                return Self.jsonResponse(for: request, body: Self.tasksJSON)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertEqual(synced.calendars, state.calendars)
        XCTAssertEqual(synced.events, state.events)
        XCTAssertEqual(synced.tasks.map(\.id), ["remote-task"])
        XCTAssertTrue(MockURLProtocol.capturedRequests.allSatisfy { $0.url?.path.hasPrefix("/calendar/") == false })
    }

    private func makeScheduler() -> SyncScheduler {
        let transport = GoogleAPITransport(
            baseURL: URL(string: "https://example.test")!,
            tokenProvider: StaticAccessTokenProvider(token: "test-token"),
            urlSession: MockURLProtocol.testSession()
        )
        let tasksClient = GoogleTasksClient(transport: transport)
        let calendarClient = GoogleCalendarClient(transport: transport)
        return SyncScheduler(tasksClient: tasksClient, calendarClient: calendarClient)
    }

    private func baseState(settings: AppSettings) -> CachedAppState {
        let now = ISO8601DateFormatter().date(from: "2026-04-30T02:00:00Z")!
        return CachedAppState(
            account: .preview,
            taskLists: [TaskListMirror(id: "list", title: "Inbox", updatedAt: now, etag: "list-etag")],
            tasks: [
                TaskMirror(
                    id: "cached-task",
                    taskListID: "list",
                    parentID: nil,
                    title: "Local task",
                    notes: "",
                    status: .needsAction,
                    dueDate: now,
                    completedAt: nil,
                    isDeleted: false,
                    isHidden: false,
                    position: nil,
                    etag: "local-task-etag",
                    updatedAt: now
                )
            ],
            calendars: [
                CalendarListMirror(
                    id: "cal",
                    summary: "Work",
                    colorHex: "#000000",
                    isSelected: true,
                    accessRole: "owner",
                    etag: "cal-etag"
                )
            ],
            events: [
                CalendarEventMirror(
                    id: "cached-event",
                    calendarID: "cal",
                    summary: "Local event",
                    details: "",
                    startDate: now,
                    endDate: now.addingTimeInterval(3600),
                    isAllDay: false,
                    status: .confirmed,
                    recurrence: [],
                    etag: "local-event-etag",
                    updatedAt: now
                )
            ],
            settings: settings
        )
    }

    private static func jsonResponse(
        for request: URLRequest,
        body: String,
        statusCode: Int = 200
    ) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json", "Date": "Thu, 30 Apr 2026 02:00:00 GMT"]
        )!
        return (response, Data(body.utf8))
    }

    private static let taskListsJSON = """
    {
      "items": [
        {"id": "list", "title": "Inbox", "updated": "2026-04-30T01:00:00Z", "etag": "list-etag"}
      ]
    }
    """

    private static let tasksJSON = """
    {
      "items": [
        {"id": "remote-task", "title": "Remote task", "status": "needsAction", "updated": "2026-04-30T01:00:00Z", "etag": "remote-task-etag"}
      ]
    }
    """

    private static let calendarListJSON = """
    {
      "items": [
        {"id": "cal", "summary": "Work", "backgroundColor": "#000000", "selected": true, "accessRole": "owner", "etag": "cal-etag"}
      ]
    }
    """

    private static let eventsJSON = """
    {
      "items": [
        {
          "id": "remote-event",
          "summary": "Remote event",
          "status": "confirmed",
          "start": {"dateTime": "2026-04-30T02:00:00Z"},
          "end": {"dateTime": "2026-04-30T03:00:00Z"},
          "updated": "2026-04-30T01:00:00Z",
          "etag": "remote-event-etag"
        }
      ],
      "nextSyncToken": "next-token"
    }
    """
}
