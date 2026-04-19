import XCTest
@testable import HotCrossBunsMac

final class TimelineLayoutTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private var now: Date {
        calendar.date(from: DateComponents(year: 2026, month: 4, day: 18))!
    }

    private func day(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))!
    }

    private func task(id: String, title: String = "t", due: Date?, completed: Bool = false, deleted: Bool = false) -> TaskMirror {
        TaskMirror(
            id: id, taskListID: "L1", parentID: nil,
            title: title, notes: "",
            status: completed ? .completed : .needsAction,
            dueDate: due, completedAt: nil,
            isDeleted: deleted, isHidden: false,
            position: nil, etag: nil, updatedAt: nil
        )
    }

    private func event(id: String, start: Date, end: Date, summary: String = "e", allDay: Bool = false, cancelled: Bool = false) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id, calendarID: "cal1",
            summary: summary, details: "",
            startDate: start, endDate: end,
            isAllDay: allDay,
            status: cancelled ? .cancelled : .confirmed,
            recurrence: [],
            etag: nil, updatedAt: nil
        )
    }

    // MARK: - items

    func testItemsFilterByRange() {
        let inside = event(id: "a", start: day(0), end: day(0).addingTimeInterval(3600))
        let past = event(id: "b", start: day(-100), end: day(-99))
        let future = event(id: "c", start: day(100), end: day(101))
        let range = day(-5)...day(5)
        let items = TimelineLayout.items(tasks: [], events: [inside, past, future], range: range, calendar: calendar)
        XCTAssertEqual(items.map(\.id), ["event-a"])
    }

    func testItemsExcludeCancelledEvents() {
        let live = event(id: "a", start: day(0), end: day(1))
        let dead = event(id: "b", start: day(0), end: day(1), cancelled: true)
        let range = day(-5)...day(5)
        let items = TimelineLayout.items(tasks: [], events: [live, dead], range: range, calendar: calendar)
        XCTAssertEqual(items.map(\.id), ["event-a"])
    }

    func testItemsExcludeDeletedTasks() {
        let live = task(id: "a", due: day(0))
        let dead = task(id: "b", due: day(0), deleted: true)
        let range = day(-5)...day(5)
        let items = TimelineLayout.items(tasks: [live, dead], events: [], range: range, calendar: calendar)
        XCTAssertEqual(items.map(\.id), ["task-a"])
    }

    func testItemsRequireDueDateForTasks() {
        let noDue = task(id: "a", due: nil)
        let withDue = task(id: "b", due: day(0))
        let range = day(-5)...day(5)
        let items = TimelineLayout.items(tasks: [noDue, withDue], events: [], range: range, calendar: calendar)
        XCTAssertEqual(items.map(\.id), ["task-b"])
    }

    func testItemsSearchFilter() {
        let match = event(id: "a", start: day(0), end: day(1), summary: "Standup")
        let noMatch = event(id: "b", start: day(0), end: day(1), summary: "Launch review")
        let range = day(-5)...day(5)
        let items = TimelineLayout.items(tasks: [], events: [match, noMatch], range: range, calendar: calendar, searchQuery: "standup")
        XCTAssertEqual(items.map(\.id), ["event-a"])
    }

    func testItemsChronologicalOrder() {
        let later = event(id: "later", start: day(2), end: day(3))
        let earlier = event(id: "earlier", start: day(0), end: day(1))
        let range = day(-5)...day(5)
        let items = TimelineLayout.items(tasks: [], events: [later, earlier], range: range, calendar: calendar)
        XCTAssertEqual(items.map(\.id), ["event-earlier", "event-later"])
    }

    // MARK: - offsets

    func testXOffsetZeroAtRangeStart() {
        let start = day(0)
        XCTAssertEqual(TimelineLayout.xOffset(for: start, rangeStart: start, pointsPerDay: 80, calendar: calendar), 0, accuracy: 0.01)
    }

    func testXOffsetProportionalToDays() {
        let start = day(0)
        let x = TimelineLayout.xOffset(for: day(3), rangeStart: start, pointsPerDay: 80, calendar: calendar)
        XCTAssertEqual(x, 240, accuracy: 0.1)
    }

    func testWidthAtLeastMinimum() {
        // Zero-duration still gets a visible minimum width.
        let d = day(0)
        let w = TimelineLayout.width(start: d, end: d, pointsPerDay: 80)
        XCTAssertGreaterThanOrEqual(w, 6)
    }

    func testWidthProportionalToDays() {
        let w = TimelineLayout.width(start: day(0), end: day(2), pointsPerDay: 80)
        XCTAssertEqual(w, 160, accuracy: 0.1)
    }

    // MARK: - default range

    func testDefaultRangeCentersOnAnchor() {
        let range = TimelineLayout.defaultRange(anchor: day(0), zoom: .week, calendar: calendar)
        // totalDays=42, half=21 → start=-21, end=+21
        XCTAssertEqual(range.lowerBound, day(-21))
        XCTAssertEqual(range.upperBound, day(21))
    }

    func testDefaultRangeWidthMatchesZoom() {
        for zoom in TimelineZoom.allCases {
            let range = TimelineLayout.defaultRange(anchor: day(0), zoom: zoom, calendar: calendar)
            let days = calendar.dateComponents([.day], from: range.lowerBound, to: range.upperBound).day!
            XCTAssertEqual(days, zoom.totalDays, "zoom \(zoom) should span \(zoom.totalDays) days")
        }
    }
}
