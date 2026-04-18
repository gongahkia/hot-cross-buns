import XCTest
@testable import HotCrossBunsMac

final class CalendarGridLayoutTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        cal.firstWeekday = 1
        return cal
    }()

    private func day(_ y: Int, _ m: Int, _ d: Int, hour: Int = 0, minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: hour, minute: minute))!
    }

    private func event(
        id: String,
        start: Date,
        end: Date,
        allDay: Bool = false,
        calendarID: String = "primary"
    ) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id,
            calendarID: calendarID,
            summary: id,
            details: "",
            startDate: start,
            endDate: end,
            isAllDay: allDay,
            status: .confirmed,
            recurrence: [],
            etag: nil,
            updatedAt: nil,
            reminderMinutes: []
        )
    }

    func testWeekDaysReturnsSevenDaysStartingOnSunday() {
        // 2026-04-18 is a Saturday
        let days = CalendarGridLayout.weekDays(containing: day(2026, 4, 18), calendar: calendar)
        XCTAssertEqual(days.count, 7)
        XCTAssertEqual(days.first, day(2026, 4, 12))
        XCTAssertEqual(days.last, day(2026, 4, 18))
    }

    func testMonthCellsReturns42AndCoversWholeMonth() {
        let cells = CalendarGridLayout.monthCells(for: day(2026, 4, 15), calendar: calendar)
        XCTAssertEqual(cells.count, 42)
        XCTAssertTrue(cells.contains(day(2026, 4, 1)))
        XCTAssertTrue(cells.contains(day(2026, 4, 30)))
    }

    func testMonthCellsStartsOnSundayLeadingPadding() {
        // april 1 2026 is wednesday; cells start on preceding sunday march 29
        let cells = CalendarGridLayout.monthCells(for: day(2026, 4, 1), calendar: calendar)
        XCTAssertEqual(cells.first, day(2026, 3, 29))
    }

    func testEventsByDayBucketsMultiDayEvent() {
        let multiDay = event(id: "multi", start: day(2026, 4, 18, hour: 9), end: day(2026, 4, 20, hour: 17))
        let result = CalendarGridLayout.eventsByDay(
            [multiDay],
            from: day(2026, 4, 18),
            to: day(2026, 4, 21),
            calendar: calendar
        )
        XCTAssertEqual(result[day(2026, 4, 18)]?.count, 1)
        XCTAssertEqual(result[day(2026, 4, 19)]?.count, 1)
        XCTAssertEqual(result[day(2026, 4, 20)]?.count, 1)
        XCTAssertNil(result[day(2026, 4, 21)])
    }

    func testEventsByDayExcludesCancelledEvents() {
        var e = event(id: "x", start: day(2026, 4, 18, hour: 9), end: day(2026, 4, 18, hour: 10))
        e.status = .cancelled
        let result = CalendarGridLayout.eventsByDay([e], from: day(2026, 4, 18), to: day(2026, 4, 18), calendar: calendar)
        XCTAssertTrue(result.isEmpty)
    }

    func testAllDayEndDayIsExclusive() {
        // google all-day events have exclusive end (ends at start-of-next-day)
        let allDay = event(id: "ad", start: day(2026, 4, 18), end: day(2026, 4, 19), allDay: true)
        let result = CalendarGridLayout.eventsByDay([allDay], from: day(2026, 4, 17), to: day(2026, 4, 20), calendar: calendar)
        XCTAssertEqual(result[day(2026, 4, 18)]?.count, 1)
        XCTAssertNil(result[day(2026, 4, 19)])
    }

    func testLayoutAssignsSeparateColumnsForOverlappingEvents() {
        let a = event(id: "a", start: day(2026, 4, 18, hour: 9), end: day(2026, 4, 18, hour: 10, minute: 30))
        let b = event(id: "b", start: day(2026, 4, 18, hour: 10), end: day(2026, 4, 18, hour: 11))
        let laid = CalendarGridLayout.layout(eventsInDay: [a, b], calendar: calendar)
        let byID = Dictionary(uniqueKeysWithValues: laid.map { ($0.event.id, $0) })
        XCTAssertEqual(byID["a"]?.columnIndex, 0)
        XCTAssertEqual(byID["b"]?.columnIndex, 1)
        XCTAssertEqual(byID["a"]?.columnCount, 2)
        XCTAssertEqual(byID["b"]?.columnCount, 2)
    }

    func testLayoutReusesColumnForNonOverlappingEvents() {
        let a = event(id: "a", start: day(2026, 4, 18, hour: 9), end: day(2026, 4, 18, hour: 10))
        let b = event(id: "b", start: day(2026, 4, 18, hour: 10), end: day(2026, 4, 18, hour: 11))
        let laid = CalendarGridLayout.layout(eventsInDay: [a, b], calendar: calendar)
        let byID = Dictionary(uniqueKeysWithValues: laid.map { ($0.event.id, $0) })
        XCTAssertEqual(byID["a"]?.columnCount, 1)
        XCTAssertEqual(byID["b"]?.columnCount, 1)
    }
}
