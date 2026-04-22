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
            let direct = model.events.filter {
                $0.calendarID == calID && $0.status != .cancelled
            }
            let bucketed = model.eventsByCalendar[calID] ?? []
            XCTAssertEqual(
                Set(direct.map(\.id)),
                Set(bucketed.map(\.id)),
                "bucket for \(calID) should match the direct filter result"
            )
        }
    }

    func testEventsByCalendarOmitsCancelledEvents() {
        let model = AppModel.preview
        for (_, bucket) in model.eventsByCalendar {
            for event in bucket {
                XCTAssertNotEqual(event.status, .cancelled,
                                  "cancelled events must not appear in the bucket index")
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
}
