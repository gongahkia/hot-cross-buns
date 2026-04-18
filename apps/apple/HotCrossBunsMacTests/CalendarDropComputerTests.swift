import XCTest
@testable import HotCrossBunsMac

final class CalendarDropComputerTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private var dayStart: Date {
        calendar.date(from: DateComponents(year: 2026, month: 4, day: 18))!
    }

    func testSnapsTo15MinIntervals() {
        // drop at y=22 with hourHeight=44 → 30 raw minutes → snaps to 30
        let start = CalendarDropComputer.snappedStart(for: 22, hourHeight: 44, dayStart: dayStart, calendar: calendar)
        XCTAssertEqual(calendar.component(.hour, from: start), 0)
        XCTAssertEqual(calendar.component(.minute, from: start), 30)
    }

    func testSnapsDownwardTo15() {
        // drop at y=80 with hourHeight=44 → ~109 raw minutes → snaps to 105
        let start = CalendarDropComputer.snappedStart(for: 80, hourHeight: 44, dayStart: dayStart, calendar: calendar)
        XCTAssertEqual(calendar.component(.hour, from: start), 1)
        XCTAssertEqual(calendar.component(.minute, from: start), 45)
    }

    func testClampsBelowZero() {
        let start = CalendarDropComputer.snappedStart(for: -200, hourHeight: 44, dayStart: dayStart, calendar: calendar)
        XCTAssertEqual(start, dayStart)
    }

    func testClampsAboveEndOfDay() {
        // very large y
        let start = CalendarDropComputer.snappedStart(for: 100_000, hourHeight: 44, dayStart: dayStart, calendar: calendar)
        // should be 23:00 (24*60 - 60 = 23:00) or earlier aligned
        let minutes = calendar.component(.hour, from: start) * 60 + calendar.component(.minute, from: start)
        XCTAssertLessThanOrEqual(minutes, 23 * 60)
    }

    func testDefaultDurationIs60Minutes() {
        let start = CalendarDropComputer.snappedStart(for: 44 * 9, hourHeight: 44, dayStart: dayStart, calendar: calendar)
        let end = CalendarDropComputer.defaultEndDate(from: start, calendar: calendar)
        XCTAssertEqual(end.timeIntervalSince(start), 60 * 60)
    }

    func testBackLinkDescriptionIncludesTitleAndDeepLink() {
        let description = CalendarDropComputer.backLinkDescription(for: "Pay rent", taskID: "abc-123")
        XCTAssertTrue(description.contains("Pay rent"))
        XCTAssertTrue(description.contains("hcb://task/abc-123"))
    }

    func testHourHeightZeroReturnsDayStart() {
        let start = CalendarDropComputer.snappedStart(for: 200, hourHeight: 0, dayStart: dayStart, calendar: calendar)
        XCTAssertEqual(start, dayStart)
    }
}
