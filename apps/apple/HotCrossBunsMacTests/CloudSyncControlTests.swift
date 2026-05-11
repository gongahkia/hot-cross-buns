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
        XCTAssertEqual(settings.completedTaskRetentionDaysBack, 365)
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

    func testSchedulerSkipsSingleMissingCalendarAndKeepsSyncingEvents() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.events]
        settings.selectedCalendarIDs = ["cal", "missing-cal"]
        settings.hasConfiguredCalendarSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            XCTAssertFalse(path.hasPrefix("/tasks/"), "Tasks endpoints must not be called when Events sync is disabled")
            if path == "/calendar/v3/users/me/calendarList" {
                return Self.jsonResponse(for: request, body: Self.calendarListWithMissingJSON)
            }
            if path == "/calendar/v3/calendars/cal/events" {
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            }
            if path == "/calendar/v3/calendars/missing-cal/events" {
                return Self.jsonResponse(for: request, body: Self.notFoundJSON, statusCode: 404)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertEqual(synced.events.map(\.id), ["remote-event"])
        XCTAssertEqual(Set(synced.calendars.map(\.id)), ["cal", "missing-cal"])
    }

    func testSchedulerPrunesSelectedCalendarsMissingFromCalendarList() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.events]
        settings.selectedCalendarIDs = ["cal", "stale-cal"]
        settings.hasConfiguredCalendarSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            XCTAssertFalse(path.hasPrefix("/tasks/"), "Tasks endpoints must not be called when Events sync is disabled")
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

        XCTAssertEqual(synced.events.map(\.id), ["remote-event"])
        XCTAssertEqual(synced.settings.selectedCalendarIDs, ["cal"])
        XCTAssertFalse(MockURLProtocol.capturedRequests.contains { $0.url?.path == "/calendar/v3/calendars/stale-cal/events" })
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

    func testSchedulerFollowsGoogleSelectedCalendarsUntilUserConfiguresSelection() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.events]
        settings.hasConfiguredCalendarSelection = false
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path == "/calendar/v3/users/me/calendarList" {
                return Self.jsonResponse(for: request, body: Self.calendarListWithHolidayJSON)
            }
            if path == "/calendar/v3/calendars/cal/events" || path == "/calendar/v3/calendars/sg-holidays/events" {
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertFalse(synced.settings.hasConfiguredCalendarSelection)
        XCTAssertEqual(synced.settings.selectedCalendarIDs, ["cal", "sg-holidays"])
        XCTAssertTrue(synced.calendars.first(where: { $0.id == "sg-holidays" })?.isSelected == true)
        XCTAssertFalse(MockURLProtocol.capturedRequests.contains { $0.url?.path == "/calendar/v3/calendars/hidden/events" })
    }

    func testSchedulerAutoSelectsNewGoogleSelectedCalendarsWhenSelectionWasConfigured() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.events]
        settings.selectedCalendarIDs = ["cal"]
        settings.hasConfiguredCalendarSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path == "/calendar/v3/users/me/calendarList" {
                return Self.jsonResponse(for: request, body: Self.calendarListWithHolidayJSON)
            }
            if path == "/calendar/v3/calendars/cal/events" || path == "/calendar/v3/calendars/sg-holidays/events" {
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertTrue(synced.settings.hasConfiguredCalendarSelection)
        XCTAssertEqual(synced.settings.selectedCalendarIDs, ["cal", "sg-holidays"])
        XCTAssertTrue(synced.calendars.first(where: { $0.id == "sg-holidays" })?.isSelected == true)
        XCTAssertFalse(MockURLProtocol.capturedRequests.contains { $0.url?.path == "/calendar/v3/calendars/hidden/events" })
    }

    func testSchedulerKeepsPreviouslyHiddenCalendarHiddenWhenGoogleSelectsIt() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.events]
        settings.selectedCalendarIDs = ["cal"]
        settings.hasConfiguredCalendarSelection = true
        var state = baseState(settings: settings)
        state.calendars.append(CalendarListMirror(
            id: "sg-holidays",
            summary: "Singapore Holidays",
            colorHex: "#0b8043",
            isSelected: false,
            accessRole: "reader",
            etag: "holiday-etag"
        ))
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path == "/calendar/v3/users/me/calendarList" {
                return Self.jsonResponse(for: request, body: Self.calendarListWithHolidayJSON)
            }
            if path == "/calendar/v3/calendars/cal/events" {
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertTrue(synced.settings.hasConfiguredCalendarSelection)
        XCTAssertEqual(synced.settings.selectedCalendarIDs, ["cal"])
        XCTAssertFalse(synced.calendars.first(where: { $0.id == "sg-holidays" })?.isSelected == true)
        XCTAssertFalse(MockURLProtocol.capturedRequests.contains { $0.url?.path == "/calendar/v3/calendars/sg-holidays/events" })
    }

    func testSchedulerUsesRetentionWindowsForFullSync() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = CloudSyncTarget.all
        settings.eventRetentionDaysBack = 365
        settings.completedTaskRetentionDaysBack = 180
        settings.selectedTaskListIDs = ["list"]
        settings.hasConfiguredTaskListSelection = true
        settings.selectedCalendarIDs = ["cal"]
        settings.hasConfiguredCalendarSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            switch path {
            case "/tasks/v1/users/@me/lists":
                return Self.jsonResponse(for: request, body: Self.taskListsJSON)
            case "/tasks/v1/lists/list/tasks":
                let query = Self.query(for: request)
                XCTAssertNil(query["updatedMin"])
                XCTAssertNotNil(query["completedMin"])
                return Self.jsonResponse(for: request, body: Self.tasksJSON)
            case "/calendar/v3/users/me/calendarList":
                return Self.jsonResponse(for: request, body: Self.calendarListJSON)
            case "/calendar/v3/calendars/cal/events":
                let query = Self.query(for: request)
                XCTAssertNil(query["syncToken"])
                XCTAssertNotNil(query["timeMin"])
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            default:
                XCTFail("Unexpected path \(path)")
                return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
            }
        }

        _ = try await makeScheduler().syncNow(mode: .balanced, baseState: state)
    }

    func testSchedulerOmitsRetentionWindowsForForeverFullSync() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = CloudSyncTarget.all
        settings.eventRetentionDaysBack = 0
        settings.completedTaskRetentionDaysBack = 0
        settings.selectedTaskListIDs = ["list"]
        settings.hasConfiguredTaskListSelection = true
        settings.selectedCalendarIDs = ["cal"]
        settings.hasConfiguredCalendarSelection = true
        let state = baseState(settings: settings)
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            switch path {
            case "/tasks/v1/users/@me/lists":
                return Self.jsonResponse(for: request, body: Self.taskListsJSON)
            case "/tasks/v1/lists/list/tasks":
                let query = Self.query(for: request)
                XCTAssertNil(query["updatedMin"])
                XCTAssertNil(query["completedMin"])
                return Self.jsonResponse(for: request, body: Self.tasksJSON)
            case "/calendar/v3/users/me/calendarList":
                return Self.jsonResponse(for: request, body: Self.calendarListJSON)
            case "/calendar/v3/calendars/cal/events":
                let query = Self.query(for: request)
                XCTAssertNil(query["syncToken"])
                XCTAssertNil(query["timeMin"])
                return Self.jsonResponse(for: request, body: Self.eventsJSON)
            default:
                XCTFail("Unexpected path \(path)")
                return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
            }
        }

        _ = try await makeScheduler().syncNow(mode: .balanced, baseState: state)
    }

    func testSchedulerPrunesOldCompletedTasksDuringIncrementalSync() async throws {
        var settings = AppSettings.default
        settings.cloudSyncTargets = [.tasks]
        settings.completedTaskRetentionDaysBack = 30
        settings.selectedTaskListIDs = ["list"]
        settings.hasConfiguredTaskListSelection = true
        var state = baseState(settings: settings)
        state.tasks = [
            Self.task(id: "old-completed", completedAt: Date().addingTimeInterval(-60 * 24 * 60 * 60), completed: true),
            Self.task(id: "recent-completed", completedAt: Date().addingTimeInterval(-5 * 24 * 60 * 60), completed: true),
            Self.task(id: "old-open", completedAt: nil, completed: false)
        ]
        state.syncCheckpoints = [
            SyncCheckpoint(
                id: SyncCheckpoint.stableID(accountID: GoogleAccount.preview.id, resourceType: .taskList, resourceID: "list"),
                accountID: GoogleAccount.preview.id,
                resourceType: .taskList,
                resourceID: "list",
                calendarSyncToken: nil,
                tasksUpdatedMin: Date().addingTimeInterval(-60),
                lastSuccessfulSyncAt: Date().addingTimeInterval(-60)
            )
        ]
        MockURLProtocol.requestHandler = { request in
            let path = try XCTUnwrap(request.url?.path)
            if path == "/tasks/v1/users/@me/lists" {
                return Self.jsonResponse(for: request, body: Self.taskListsJSON)
            }
            if path == "/tasks/v1/lists/list/tasks" {
                let query = Self.query(for: request)
                XCTAssertNotNil(query["updatedMin"])
                XCTAssertNil(query["completedMin"])
                return Self.jsonResponse(for: request, body: #"{"items":[]}"#)
            }
            XCTFail("Unexpected path \(path)")
            return Self.jsonResponse(for: request, body: #"{}"#, statusCode: 404)
        }

        let synced = try await makeScheduler().syncNow(mode: .balanced, baseState: state)

        XCTAssertEqual(Set(synced.tasks.map(\.id)), ["recent-completed", "old-open"])
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

    private static func query(for request: URLRequest) -> [String: String] {
        let queryItems = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: queryItems.map { ($0.name, $0.value ?? "") })
    }

    private static func task(id: String, completedAt: Date?, completed: Bool) -> TaskMirror {
        TaskMirror(
            id: id,
            taskListID: "list",
            parentID: nil,
            title: id,
            notes: "",
            status: completed ? .completed : .needsAction,
            dueDate: nil,
            completedAt: completedAt,
            isDeleted: false,
            isHidden: false,
            position: nil,
            etag: "\(id)-etag",
            updatedAt: completedAt
        )
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

    private static let calendarListWithMissingJSON = """
    {
      "items": [
        {"id": "cal", "summary": "Work", "backgroundColor": "#000000", "selected": true, "accessRole": "owner", "etag": "cal-etag"},
        {"id": "missing-cal", "summary": "Missing", "backgroundColor": "#666666", "selected": true, "accessRole": "reader", "etag": "missing-etag"}
      ]
    }
    """

    private static let calendarListWithHolidayJSON = """
    {
      "items": [
        {"id": "cal", "summary": "Work", "backgroundColor": "#000000", "selected": true, "accessRole": "owner", "etag": "cal-etag"},
        {"id": "sg-holidays", "summary": "Singapore Holidays", "backgroundColor": "#0b8043", "selected": true, "accessRole": "reader", "etag": "holiday-etag"},
        {"id": "hidden", "summary": "Hidden", "backgroundColor": "#666666", "selected": false, "accessRole": "reader", "etag": "hidden-etag"}
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

    private static let notFoundJSON = """
    {
      "error": {
        "code": 404,
        "message": "Not Found",
        "status": "NOT_FOUND"
      }
    }
    """
}
