import XCTest
@testable import HotCrossBunsMac

final class ModelPersistenceTests: XCTestCase {
    func testAppSettingsDecodeDefaultsNewFlags() throws {
        let data = Data(
            """
            {
              "syncMode": "manual",
              "selectedCalendarIDs": ["primary"],
              "selectedTaskListIDs": ["tasks"],
              "enableLocalNotifications": true
            }
            """.utf8
        )

        let settings = try JSONDecoder().decode(AppSettings.self, from: data)

        XCTAssertEqual(settings.syncMode, .manual)
        XCTAssertEqual(settings.selectedCalendarIDs, ["primary"])
        XCTAssertEqual(settings.selectedTaskListIDs, ["tasks"])
        XCTAssertTrue(settings.enableLocalNotifications)
        XCTAssertFalse(settings.hasConfiguredCalendarSelection)
        XCTAssertFalse(settings.hasConfiguredTaskListSelection)
        XCTAssertFalse(settings.hasCompletedOnboarding)
    }

    func testCalendarEventDecodeDefaultsMissingReminders() throws {
        let data = Data(
            """
            {
              "id": "event-1",
              "calendarID": "primary",
              "summary": "Planning",
              "details": "",
              "startDate": "2026-04-18T01:00:00Z",
              "endDate": "2026-04-18T02:00:00Z",
              "isAllDay": false,
              "status": "confirmed",
              "recurrence": [],
              "etag": "etag-1",
              "updatedAt": "2026-04-18T00:00:00Z"
            }
            """.utf8
        )
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let event = try decoder.decode(CalendarEventMirror.self, from: data)

        XCTAssertEqual(event.id, "event-1")
        XCTAssertEqual(event.reminderMinutes, [])
    }

    func testCachedAppStateDecodeDefaultsMissingCollections() throws {
        let data = Data("{}".utf8)

        let state = try JSONDecoder().decode(CachedAppState.self, from: data)

        XCTAssertNil(state.account)
        XCTAssertTrue(state.taskLists.isEmpty)
        XCTAssertTrue(state.tasks.isEmpty)
        XCTAssertTrue(state.calendars.isEmpty)
        XCTAssertTrue(state.events.isEmpty)
        XCTAssertEqual(state.settings.syncMode, .balanced)
        XCTAssertTrue(state.syncCheckpoints.isEmpty)
        XCTAssertTrue(state.pendingMutations.isEmpty)
    }

    func testLocalCacheStoreRoundTripsState() async throws {
        let fileURL = FileManager.default.temporaryDirectory
            .appending(path: "HotCrossBunsTests", directoryHint: .isDirectory)
            .appending(path: UUID().uuidString)
            .appendingPathExtension("json")
        defer { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }
        let store = LocalCacheStore(fileURL: fileURL)

        await store.save(.preview)
        let loadedState = await store.loadCachedState()

        XCTAssertEqual(loadedState.account, .preview)
        XCTAssertEqual(loadedState.taskLists.count, CachedAppState.preview.taskLists.count)
        XCTAssertEqual(loadedState.tasks.count, CachedAppState.preview.tasks.count)
        XCTAssertEqual(loadedState.calendars.count, CachedAppState.preview.calendars.count)
        XCTAssertEqual(loadedState.events.count, CachedAppState.preview.events.count)
        let cacheFilePath = await store.cacheFilePath()
        XCTAssertEqual(cacheFilePath, fileURL.path)
    }

    func testTodaySnapshotExcludesCompletedDeletedAndCancelledItems() {
        let calendar = Calendar(identifier: .gregorian)
        let referenceDate = calendar.date(from: DateComponents(year: 2026, month: 4, day: 18, hour: 12))!
        let yesterday = calendar.date(byAdding: .day, value: -1, to: referenceDate)!
        let todayMorning = calendar.date(from: DateComponents(year: 2026, month: 4, day: 18, hour: 9))!
        let todayAfternoon = calendar.date(from: DateComponents(year: 2026, month: 4, day: 18, hour: 14))!
        let taskListID = "tasks"
        let calendarID = "primary"
        let tasks = [
            task(id: "due-today", taskListID: taskListID, dueDate: todayMorning, status: .needsAction, isDeleted: false),
            task(id: "overdue", taskListID: taskListID, dueDate: yesterday, status: .needsAction, isDeleted: false),
            task(id: "completed", taskListID: taskListID, dueDate: todayMorning, status: .completed, isDeleted: false),
            task(id: "deleted", taskListID: taskListID, dueDate: todayMorning, status: .needsAction, isDeleted: true)
        ]
        let events = [
            event(id: "later", calendarID: calendarID, startDate: todayAfternoon, status: .confirmed),
            event(id: "cancelled", calendarID: calendarID, startDate: todayMorning, status: .cancelled),
            event(id: "earlier", calendarID: calendarID, startDate: todayMorning, status: .confirmed)
        ]

        let snapshot = TodaySnapshot.build(
            tasks: tasks,
            events: events,
            referenceDate: referenceDate,
            calendar: calendar
        )

        XCTAssertEqual(snapshot.dueTasks.map(\.id), ["due-today"])
        XCTAssertEqual(snapshot.overdueCount, 1)
        XCTAssertEqual(snapshot.scheduledEvents.map(\.id), ["earlier", "later"])
    }

    private func task(
        id: String,
        taskListID: String,
        dueDate: Date?,
        status: TaskStatus,
        isDeleted: Bool
    ) -> TaskMirror {
        TaskMirror(
            id: id,
            taskListID: taskListID,
            parentID: nil,
            title: id,
            notes: "",
            status: status,
            dueDate: dueDate,
            completedAt: status == .completed ? Date() : nil,
            isDeleted: isDeleted,
            isHidden: false,
            position: nil,
            etag: nil,
            updatedAt: nil
        )
    }

    private func event(
        id: String,
        calendarID: String,
        startDate: Date,
        status: CalendarEventStatus
    ) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id,
            calendarID: calendarID,
            summary: id,
            details: "",
            startDate: startDate,
            endDate: startDate.addingTimeInterval(1800),
            isAllDay: false,
            status: status,
            recurrence: [],
            etag: nil,
            updatedAt: nil
        )
    }
}
