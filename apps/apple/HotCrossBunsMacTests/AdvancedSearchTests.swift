import XCTest
@testable import HotCrossBunsMac

final class AdvancedSearchParserTests: XCTestCase {
    func testEmptyIsEmpty() {
        XCTAssertTrue(AdvancedSearchParser.parse("").isEmpty)
        XCTAssertTrue(AdvancedSearchParser.parse("   ").isEmpty)
    }

    func testBareKeywords() {
        let q = AdvancedSearchParser.parse("overdue starred completed")
        XCTAssertTrue(q.requireOverdue)
        XCTAssertTrue(q.requireStarred)
        XCTAssertTrue(q.requireCompleted)
        XCTAssertTrue(q.freeText.isEmpty)
    }

    func testDoneAliasForCompleted() {
        let q = AdvancedSearchParser.parse("done")
        XCTAssertTrue(q.requireCompleted)
    }

    func testFieldTokens() {
        let q = AdvancedSearchParser.parse("title:bug tag:work list:home calendar:personal attendee:alice")
        XCTAssertEqual(q.titleContains, ["bug"])
        XCTAssertEqual(q.tagsAll, ["work"])
        XCTAssertEqual(q.listMatch, "home")
        XCTAssertEqual(q.calendarMatch, "personal")
        XCTAssertEqual(q.attendeeMatch, "alice")
    }

    func testHasKeywords() {
        let q = AdvancedSearchParser.parse("has:notes has:location has:due")
        XCTAssertTrue(q.requireNotes)
        XCTAssertTrue(q.requireLocation)
        XCTAssertTrue(q.requireDue)
    }

    func testQuotedValuesPreserveSpaces() {
        let q = AdvancedSearchParser.parse("list:\"Work Email\"")
        XCTAssertEqual(q.listMatch, "Work Email")
    }

    func testFreeTextResidue() {
        let q = AdvancedSearchParser.parse("tag:deep focus block")
        XCTAssertEqual(q.tagsAll, ["deep"])
        XCTAssertEqual(q.freeText, "focus block")
    }

    func testRegexMode() {
        let q = AdvancedSearchParser.parse("/^standup/")
        XCTAssertEqual(q.regex, "^standup")
        XCTAssertTrue(q.freeText.isEmpty)
        XCTAssertTrue(q.titleContains.isEmpty)
    }

    func testUnknownFieldFallsBackToFreeText() {
        let q = AdvancedSearchParser.parse("foo:bar")
        XCTAssertEqual(q.freeText, "foo:bar")
    }

    func testMultipleTitleTokensAccumulate() {
        let q = AdvancedSearchParser.parse("title:foo title:bar")
        XCTAssertEqual(q.titleContains, ["foo", "bar"])
    }

    func testTagsLowercased() {
        let q = AdvancedSearchParser.parse("tag:WORK")
        XCTAssertEqual(q.tagsAll, ["work"])
    }
}

final class AdvancedSearchMatcherTests: XCTestCase {
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

    private let taskLists = [
        TaskListMirror(id: "L1", title: "Work"),
        TaskListMirror(id: "L2", title: "Home")
    ]

    private let calendars = [
        CalendarListMirror(id: "cal1", summary: "Primary", colorHex: "#aaa", isSelected: true, accessRole: "owner"),
        CalendarListMirror(id: "cal2", summary: "Work Calendar", colorHex: "#bbb", isSelected: true, accessRole: "owner")
    ]

    private func task(id: String, title: String = "task", list: String = "L1", notes: String = "", due: Date? = nil, completed: Bool = false) -> TaskMirror {
        TaskMirror(
            id: id, taskListID: list, parentID: nil,
            title: title, notes: notes,
            status: completed ? .completed : .needsAction,
            dueDate: due, completedAt: nil,
            isDeleted: false, isHidden: false,
            position: nil, etag: nil, updatedAt: nil
        )
    }

    private func event(id: String, summary: String = "e", cal: String = "cal1", location: String = "", attendees: [String] = []) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id, calendarID: cal,
            summary: summary, details: "",
            startDate: Date(), endDate: Date().addingTimeInterval(3600),
            isAllDay: false,
            status: .confirmed,
            recurrence: [],
            etag: nil, updatedAt: nil,
            location: location,
            attendeeEmails: attendees
        )
    }

    private func matches(_ entity: QuickSwitcherEntity, _ raw: String) -> Bool {
        let q = AdvancedSearchParser.parse(raw)
        return AdvancedSearchMatcher.matches(entity, query: q, calendars: calendars, taskLists: taskLists, now: now, calendar: calendar)
    }

    // MARK: - task filters

    func testOverdueFiltersTasks() {
        let t = task(id: "a", due: day(-1))
        let notOverdue = task(id: "b", due: day(1))
        XCTAssertTrue(matches(.task(t), "overdue"))
        XCTAssertFalse(matches(.task(notOverdue), "overdue"))
    }

    func testStarredFilter() {
        let starred = task(id: "a", title: "⭐ important")
        let notStarred = task(id: "b", title: "plain")
        XCTAssertTrue(matches(.task(starred), "starred"))
        XCTAssertFalse(matches(.task(notStarred), "starred"))
    }

    func testListByTitle() {
        let t = task(id: "a", list: "L1")
        XCTAssertTrue(matches(.task(t), "list:Work"))
        XCTAssertFalse(matches(.task(t), "list:Home"))
    }

    func testTagFilter() {
        let t = task(id: "a", title: "fix #work #urgent")
        XCTAssertTrue(matches(.task(t), "tag:work"))
        XCTAssertTrue(matches(.task(t), "tag:work tag:urgent"))
        XCTAssertFalse(matches(.task(t), "tag:personal"))
    }

    func testHasNotesFilter() {
        let withNotes = task(id: "a", notes: "notes here")
        let empty = task(id: "b", notes: "")
        XCTAssertTrue(matches(.task(withNotes), "has:notes"))
        XCTAssertFalse(matches(.task(empty), "has:notes"))
    }

    // MARK: - event filters

    func testCalendarFilter() {
        let e = event(id: "a", cal: "cal2")
        XCTAssertTrue(matches(.event(e), "calendar:\"Work Calendar\""))
        XCTAssertFalse(matches(.event(e), "calendar:Primary"))
    }

    func testAttendeeFilter() {
        let e = event(id: "a", attendees: ["alice@example.com", "bob@example.com"])
        XCTAssertTrue(matches(.event(e), "attendee:alice"))
        XCTAssertFalse(matches(.event(e), "attendee:charlie"))
    }

    func testHasLocationFilter() {
        let withLoc = event(id: "a", location: "Zoom")
        let withoutLoc = event(id: "b", location: "")
        XCTAssertTrue(matches(.event(withLoc), "has:location"))
        XCTAssertFalse(matches(.event(withoutLoc), "has:location"))
    }

    func testTasksDontMatchEventOnlyFilters() {
        let t = task(id: "a")
        XCTAssertFalse(matches(.task(t), "attendee:alice"))
        XCTAssertFalse(matches(.task(t), "calendar:Work"))
        XCTAssertFalse(matches(.task(t), "has:location"))
    }

    func testEventsDontMatchTaskOnlyFilters() {
        let e = event(id: "a")
        XCTAssertFalse(matches(.event(e), "overdue"))
        XCTAssertFalse(matches(.event(e), "starred"))
        XCTAssertFalse(matches(.event(e), "list:Work"))
        XCTAssertFalse(matches(.event(e), "tag:deep"))
    }

    // MARK: - title containment

    func testTitleContainsIsAND() {
        let t = task(id: "a", title: "fix launch bug")
        XCTAssertTrue(matches(.task(t), "title:fix title:bug"))
        XCTAssertFalse(matches(.task(t), "title:fix title:deploy"))
    }

    // MARK: - regex

    func testRegexMatch() {
        let t = task(id: "a", title: "Standup Wednesday")
        let q = AdvancedSearchParser.parse("/^Standup/")
        XCTAssertEqual(q.regex, "^Standup")
        XCTAssertTrue(AdvancedSearchMatcher.regexMatches(.task(t), regexPattern: "^Standup"))
        XCTAssertFalse(AdvancedSearchMatcher.regexMatches(.task(t), regexPattern: "^Launch"))
    }

    func testRegexInvalidPatternReturnsFalse() {
        let t = task(id: "a", title: "x")
        // Unterminated group — should not crash, just return false.
        XCTAssertFalse(AdvancedSearchMatcher.regexMatches(.task(t), regexPattern: "(unterminated"))
    }
}
