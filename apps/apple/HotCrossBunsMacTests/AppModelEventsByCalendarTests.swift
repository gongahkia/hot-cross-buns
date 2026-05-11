import XCTest
@testable import HotCrossBunsMac

// Tests for A2 — pre-bucketed eventsByCalendar index. Verifies the index
// is correctly populated after rebuildSnapshots, excludes cancelled
// events, and that grouped lookups are equivalent to direct filter
// results across the full events array.
@MainActor
final class AppModelEventsByCalendarTests: XCTestCase {

    func testEventsByCalendarMatchesDirectFilter() async {
        let model = AppModel.preview
        // preview seeds events across the preview calendars; rebuildSnapshots
        // runs in apply() during installPreviewData.
        let calendarIDs = Set(model.calendars.map(\.id))

        for calID in calendarIDs {
            let directIDs = Set(model.events.filter {
                $0.calendarID == calID && $0.status != .cancelled
            }.map(\.id))
            let bucketedIDs = Set(model.eventsByCalendar[calID] ?? [])
            XCTAssertEqual(
                directIDs,
                bucketedIDs,
                "bucket for \(calID) should match the direct filter result"
            )
        }
    }

    func testEventsByCalendarOmitsCancelledEvents() {
        let model = AppModel.preview
        for (_, bucket) in model.eventsByCalendar {
            for eventID in bucket {
                guard let event = model.event(id: eventID) else {
                    XCTFail("bucket index referenced missing event \(eventID)")
                    continue
                }
                XCTAssertNotEqual(
                    event.status,
                    .cancelled,
                    "cancelled events must not appear in the bucket index"
                )
            }
        }
    }

    func testEventsByCalendarTotalDoesNotExceedRawEvents() {
        let model = AppModel.preview
        let bucketedTotal = model.eventsByCalendar.values.reduce(0) { $0 + $1.count }
        let activeRawTotal = model.events.filter { $0.status != .cancelled }.count
        XCTAssertEqual(bucketedTotal, activeRawTotal,
                       "every active event must appear in exactly one calendar bucket")
    }

    func testScheduledDerivedSnapshotRebuildAppliesIndexesBeforeRevisionBump() async {
        let model = AppModel.preview
        let initialRevision = model.dataRevision
        guard let listID = model.taskLists.first?.id else {
            XCTFail("preview data should include task lists")
            return
        }

        model.toggleTaskList(listID)

        XCTAssertTrue(model.isRebuildingDerivedSnapshots)
        await waitForRevisionChange(model, from: initialRevision)

        XCTAssertFalse(model.isRebuildingDerivedSnapshots)
        XCTAssertGreaterThan(model.dataRevision, initialRevision)
        XCTAssertEqual(model.visibleTaskListIDs, model.settings.selectedTaskListIDs)
        XCTAssertEqual(model.taskByIDSnapshot.count, model.tasks.count)
        XCTAssertEqual(model.eventByIDSnapshot.count, model.events.count)
        XCTAssertTrue(model.tasksByDueDate.values.joined().allSatisfy { model.task(id: $0) != nil })
        XCTAssertTrue(model.eventsByDay.values.joined().allSatisfy { model.event(id: $0) != nil })
    }

    private func waitForRevisionChange(_ model: AppModel, from revision: UInt64, file: StaticString = #filePath, line: UInt = #line) async {
        let deadline = Date().addingTimeInterval(2)
        while model.dataRevision == revision, Date() < deadline {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        if model.dataRevision == revision {
            XCTFail("timed out waiting for derived snapshot rebuild", file: file, line: line)
        }
    }
}
