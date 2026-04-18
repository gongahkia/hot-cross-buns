import XCTest
@testable import HotCrossBunsMac

final class RecurrenceRuleTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    func testRoundTripDaily() {
        let rule = RecurrenceRule(frequency: .daily, interval: 3)
        let round = RecurrenceRule.parse(rrule: rule.rruleString())
        XCTAssertEqual(round, rule)
    }

    func testRoundTripWeekly() {
        let rule = RecurrenceRule(frequency: .weekly, interval: 2)
        XCTAssertEqual(RecurrenceRule.parse(rrule: rule.rruleString()), rule)
    }

    func testParseWithoutRRULEPrefix() {
        XCTAssertEqual(
            RecurrenceRule.parse(rrule: "FREQ=MONTHLY;INTERVAL=1"),
            RecurrenceRule(frequency: .monthly, interval: 1)
        )
    }

    func testParseInvalidReturnsNil() {
        XCTAssertNil(RecurrenceRule.parse(rrule: "junk"))
    }

    func testAdvanceDaily() {
        let rule = RecurrenceRule(frequency: .daily, interval: 1)
        let start = calendar.date(from: DateComponents(year: 2026, month: 4, day: 18))!
        let expected = calendar.date(from: DateComponents(year: 2026, month: 4, day: 19))!
        XCTAssertEqual(rule.advance(start, calendar: calendar), expected)
    }

    func testAdvanceWeeklyInterval2() {
        let rule = RecurrenceRule(frequency: .weekly, interval: 2)
        let start = calendar.date(from: DateComponents(year: 2026, month: 4, day: 18))!
        let expected = calendar.date(from: DateComponents(year: 2026, month: 5, day: 2))!
        XCTAssertEqual(rule.advance(start, calendar: calendar), expected)
    }

    func testMarkerRoundTrip() {
        let rule = RecurrenceRule(frequency: .weekly, interval: 1)
        let notes = "body text"
        let encoded = TaskRecurrenceMarkers.encode(notes: notes, rule: rule)
        XCTAssertEqual(TaskRecurrenceMarkers.rule(from: encoded), rule)
        XCTAssertEqual(TaskRecurrenceMarkers.strippedNotes(from: encoded), "body text")
    }

    func testMarkerEncodeNilStripsExisting() {
        let original = "body\n\n[recurrence: RRULE:FREQ=DAILY;INTERVAL=1]"
        XCTAssertEqual(TaskRecurrenceMarkers.encode(notes: original, rule: nil), "body")
    }
}
