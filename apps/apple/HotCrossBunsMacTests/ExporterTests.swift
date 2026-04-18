import XCTest
@testable import HotCrossBunsMac

final class ExporterTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private func day(_ y: Int, _ m: Int, _ d: Int, hour: Int = 0, minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: hour, minute: minute))!
    }

    private func makeEvent(
        id: String = "evt-1",
        summary: String = "Planning",
        details: String = "Sprint review",
        start: Date? = nil,
        end: Date? = nil,
        allDay: Bool = false,
        reminders: [Int] = []
    ) -> CalendarEventMirror {
        CalendarEventMirror(
            id: id,
            calendarID: "primary",
            summary: summary,
            details: details,
            startDate: start ?? day(2026, 4, 18, hour: 14),
            endDate: end ?? day(2026, 4, 18, hour: 15),
            isAllDay: allDay,
            status: .confirmed,
            recurrence: [],
            etag: nil,
            updatedAt: nil,
            reminderMinutes: reminders
        )
    }

    private func makeTask(title: String = "Pay rent", notes: String = "ACH", due: Date? = nil, completed: Bool = false) -> TaskMirror {
        TaskMirror(
            id: "t1",
            taskListID: "L1",
            parentID: nil,
            title: title,
            notes: notes,
            status: completed ? .completed : .needsAction,
            dueDate: due,
            completedAt: nil,
            isDeleted: false,
            isHidden: false,
            position: nil,
            etag: nil,
            updatedAt: nil
        )
    }

    func testTaskMarkdownIncludesListDueNotes() {
        let md = TaskMarkdownExporter.markdown(for: makeTask(due: day(2026, 4, 20)), taskListTitle: "Personal")
        XCTAssertTrue(md.contains("- [ ] Pay rent"))
        XCTAssertTrue(md.contains("List: Personal"))
        XCTAssertTrue(md.contains("Due:"))
        XCTAssertTrue(md.contains("Notes: ACH"))
    }

    func testTaskMarkdownCompletedUsesCheckedBox() {
        let md = TaskMarkdownExporter.markdown(for: makeTask(completed: true))
        XCTAssertTrue(md.hasPrefix("- [x]"))
    }

    func testEventMarkdownAllDay() {
        let md = EventMarkdownExporter.markdown(for: makeEvent(allDay: true, reminders: []))
        XCTAssertTrue(md.contains("## Planning"))
        XCTAssertTrue(md.contains("(all day)"))
    }

    func testEventMarkdownTimed() {
        let md = EventMarkdownExporter.markdown(for: makeEvent())
        XCTAssertTrue(md.contains("–"))
    }

    func testICSContainsRequiredFields() {
        let ics = EventICSExporter.ics(for: makeEvent(reminders: [10]))
        XCTAssertTrue(ics.contains("BEGIN:VCALENDAR"))
        XCTAssertTrue(ics.contains("END:VCALENDAR"))
        XCTAssertTrue(ics.contains("BEGIN:VEVENT"))
        XCTAssertTrue(ics.contains("END:VEVENT"))
        XCTAssertTrue(ics.contains("SUMMARY:Planning"))
        XCTAssertTrue(ics.contains("UID:evt-1@hotcrossbuns"))
        XCTAssertTrue(ics.contains("TRIGGER:-PT10M"))
    }

    func testICSAllDayUsesValueDate() {
        let ics = EventICSExporter.ics(for: makeEvent(
            start: day(2026, 4, 18),
            end: day(2026, 4, 19),
            allDay: true
        ))
        XCTAssertTrue(ics.contains("DTSTART;VALUE=DATE:20260418"))
        XCTAssertTrue(ics.contains("DTEND;VALUE=DATE:20260419"))
    }

    func testICSEscapesSpecialCharacters() {
        let ics = EventICSExporter.ics(for: makeEvent(summary: "Design; review, part 1"))
        XCTAssertTrue(ics.contains("SUMMARY:Design\\; review\\, part 1"))
    }

    func testICSLinesUseCRLF() {
        let ics = EventICSExporter.ics(for: makeEvent())
        XCTAssertTrue(ics.contains("\r\n"))
    }
}
