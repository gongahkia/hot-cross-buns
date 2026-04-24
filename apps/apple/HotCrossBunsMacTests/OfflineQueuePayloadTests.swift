import XCTest
@testable import HotCrossBunsMac

final class OfflineQueuePayloadTests: XCTestCase {
    func testTaskCreatePayloadRoundTrip() throws {
        let payload = PendingTaskCreatePayload(
            localID: "local-ABC",
            taskListID: "list1",
            title: "Write tests",
            notes: "Cover the offline queue",
            dueDate: Date(timeIntervalSince1970: 1_742_793_600),
            parentID: nil
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeTaskCreate(encoded)
        XCTAssertEqual(decoded, payload)
    }

    func testEventCreatePayloadRoundTrip() throws {
        let payload = PendingEventCreatePayload(
            localID: "local-EVT",
            calendarID: "primary",
            summary: "Review",
            details: "**notes**",
            startDate: Date(timeIntervalSince1970: 1_742_793_600),
            endDate: Date(timeIntervalSince1970: 1_742_797_200),
            isAllDay: false,
            reminderMinutes: 15,
            location: "HQ",
            recurrence: ["RRULE:FREQ=WEEKLY"],
            attendeeEmails: ["a@example.com"],
            notifyGuests: true,
            addGoogleMeet: true,
            colorId: "5"
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeEventCreate(encoded)
        XCTAssertEqual(decoded, payload)
    }

    func testTaskUpdatePayloadRoundTripPreservesEtagSnapshot() throws {
        let payload = PendingTaskUpdatePayload(
            taskListID: "list1",
            taskID: "task-42",
            title: "Renamed",
            notes: "New notes",
            dueDate: nil,
            etagSnapshot: "etag-xyz"
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeTaskUpdate(encoded)
        XCTAssertEqual(decoded, payload)
        XCTAssertEqual(decoded.etagSnapshot, "etag-xyz")
    }

    func testTaskCompletionPayloadRoundTrip() throws {
        let payload = PendingTaskCompletionPayload(
            taskListID: "list1",
            taskID: "task-42",
            isCompleted: true,
            etagSnapshot: "etag-abc"
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeTaskCompletion(encoded)
        XCTAssertEqual(decoded, payload)
    }

    func testTaskDeletePayloadRoundTrip() throws {
        let payload = PendingTaskDeletePayload(
            taskListID: "list1",
            taskID: "task-42",
            etagSnapshot: "etag-del"
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeTaskDelete(encoded)
        XCTAssertEqual(decoded, payload)
    }

    func testEventUpdatePayloadRoundTrip() throws {
        let payload = PendingEventUpdatePayload(
            calendarID: "primary",
            eventID: "event-1",
            summary: "Moved",
            details: "Body",
            startDate: Date(timeIntervalSince1970: 1_742_793_600),
            endDate: Date(timeIntervalSince1970: 1_742_797_200),
            isAllDay: false,
            reminderMinutes: 30,
            location: "",
            recurrence: [],
            attendeeEmails: [],
            notifyGuests: false,
            etagSnapshot: "evt-etag",
            addGoogleMeet: false,
            colorId: nil
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeEventUpdate(encoded)
        XCTAssertEqual(decoded, payload)
    }

    func testEventDeletePayloadRoundTrip() throws {
        let payload = PendingEventDeletePayload(
            calendarID: "primary",
            eventID: "event-1",
            etagSnapshot: "evt-etag"
        )
        let encoded = try PendingMutationEncoder.encode(payload)
        let decoded = try PendingMutationEncoder.decodeEventDelete(encoded)
        XCTAssertEqual(decoded, payload)
    }

    func testMutationFactoriesProduceCorrectDiscriminators() throws {
        let taskCreate = try PendingMutation.taskCreate(payload: .init(
            localID: "local-1", taskListID: "l", title: "t", notes: "", dueDate: nil, parentID: nil
        ))
        XCTAssertEqual(taskCreate.resourceType, .task)
        XCTAssertEqual(taskCreate.action, .create)

        let taskUpdate = try PendingMutation.taskUpdate(payload: .init(
            taskListID: "l", taskID: "t", title: "x", notes: "", dueDate: nil, etagSnapshot: nil
        ))
        XCTAssertEqual(taskUpdate.resourceType, .task)
        XCTAssertEqual(taskUpdate.action, .update)

        let taskCompletion = try PendingMutation.taskCompletion(payload: .init(
            taskListID: "l", taskID: "t", isCompleted: true, etagSnapshot: nil
        ))
        XCTAssertEqual(taskCompletion.resourceType, .task)
        XCTAssertEqual(taskCompletion.action, .completion)

        let taskDelete = try PendingMutation.taskDelete(payload: .init(
            taskListID: "l", taskID: "t", etagSnapshot: nil
        ))
        XCTAssertEqual(taskDelete.resourceType, .task)
        XCTAssertEqual(taskDelete.action, .delete)

        let eventUpdate = try PendingMutation.eventUpdate(payload: .init(
            calendarID: "c", eventID: "e", summary: "s", details: "", startDate: .distantPast, endDate: .distantFuture, isAllDay: false, reminderMinutes: nil, location: "", recurrence: [], attendeeEmails: [], notifyGuests: false, etagSnapshot: nil
        ))
        XCTAssertEqual(eventUpdate.resourceType, .event)
        XCTAssertEqual(eventUpdate.action, .update)

        let eventDelete = try PendingMutation.eventDelete(payload: .init(
            calendarID: "c", eventID: "e", etagSnapshot: nil
        ))
        XCTAssertEqual(eventDelete.resourceType, .event)
        XCTAssertEqual(eventDelete.action, .delete)
    }

    func testIsTransientClassification() {
        XCTAssertTrue(GoogleAPIError.httpStatus(429, nil).isTransient)
        XCTAssertTrue(GoogleAPIError.httpStatus(500, nil).isTransient)
        XCTAssertTrue(GoogleAPIError.httpStatus(503, nil).isTransient)
        XCTAssertTrue(GoogleAPIError.httpStatus(599, nil).isTransient)
        XCTAssertFalse(GoogleAPIError.invalidPayload(nil).isTransient)
        XCTAssertFalse(GoogleAPIError.httpStatus(400, nil).isTransient)
        XCTAssertFalse(GoogleAPIError.httpStatus(401, nil).isTransient)
        XCTAssertFalse(GoogleAPIError.httpStatus(403, nil).isTransient)
        XCTAssertFalse(GoogleAPIError.httpStatus(404, nil).isTransient)
        XCTAssertFalse(GoogleAPIError.preconditionFailed.isTransient)
        XCTAssertFalse(GoogleAPIError.invalidResponse.isTransient)
        XCTAssertFalse(GoogleAPIError.invalidURL.isTransient)
    }

    func testSyncFailureKindClassification() {
        XCTAssertEqual(SyncFailureKind.classify(GoogleAPIError.httpStatus(429, nil)), .rateLimited)
        XCTAssertEqual(SyncFailureKind.classify(GoogleAPIError.httpStatus(503, nil)), .serviceUnavailable)
        XCTAssertEqual(SyncFailureKind.classify(GoogleAPIError.invalidPayload(nil)), .invalidPayload)
        XCTAssertEqual(
            SyncFailureKind.classify(URLError(.notConnectedToInternet)),
            .offline
        )
    }

    func testSyncFailureCopyUsesOfflineMessaging() {
        let copy = AppStatusBanner.syncFailureCopy(
            fallbackMessage: "ignored",
            isPaused: false,
            failureKind: .other,
            networkReachability: .offline
        )

        XCTAssertEqual(copy.title, "You're offline")
        XCTAssertEqual(copy.message, "Changes are queued locally and will sync when you reconnect.")
        XCTAssertEqual(copy.systemImage, "wifi.slash")
    }

    func testSyncFailureCopyUsesRateLimitMessaging() {
        let copy = AppStatusBanner.syncFailureCopy(
            fallbackMessage: "ignored",
            isPaused: false,
            failureKind: .rateLimited,
            networkReachability: .online
        )

        XCTAssertEqual(copy.title, "Google is rate-limiting requests")
        XCTAssertEqual(copy.message, "Hot Cross Buns will retry automatically. Your local changes are safe.")
    }

    func testSyncFailureCopyUsesServiceUnavailableMessaging() {
        let copy = AppStatusBanner.syncFailureCopy(
            fallbackMessage: "ignored",
            isPaused: false,
            failureKind: .serviceUnavailable,
            networkReachability: .online
        )

        XCTAssertEqual(copy.title, "Google Calendar or Tasks is briefly unavailable")
        XCTAssertEqual(copy.message, "Hot Cross Buns will retry automatically as soon as the service recovers.")
    }
}
