import XCTest
@testable import HotCrossBunsMac

final class CustomFilterTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private var now: Date {
        calendar.date(from: DateComponents(year: 2026, month: 4, day: 18, hour: 10))!
    }

    private func day(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))!
    }

    private func task(
        id: String,
        title: String = "task",
        list: String = "L1",
        due: Date? = nil,
        completed: Bool = false
    ) -> TaskMirror {
        TaskMirror(
            id: id,
            taskListID: list,
            parentID: nil,
            title: title,
            notes: "",
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

    func testDueWindowAny() {
        let filter = CustomFilterDefinition(name: "all")
        XCTAssertTrue(filter.matches(task(id: "a"), now: now, calendar: calendar))
    }

    func testDueWindowOverdue() {
        let filter = CustomFilterDefinition(name: "o", dueWindow: .overdue)
        XCTAssertTrue(filter.matches(task(id: "a", due: day(-1)), now: now, calendar: calendar))
        XCTAssertFalse(filter.matches(task(id: "b", due: day(0)), now: now, calendar: calendar))
        XCTAssertFalse(filter.matches(task(id: "c", due: nil), now: now, calendar: calendar))
    }

    func testCompletedExcludedByDefault() {
        let filter = CustomFilterDefinition(name: "x")
        XCTAssertFalse(filter.matches(task(id: "a", completed: true), now: now, calendar: calendar))
    }

    func testCompletedIncludedWhenRequested() {
        let filter = CustomFilterDefinition(name: "x", includeCompleted: true)
        XCTAssertTrue(filter.matches(task(id: "a", completed: true), now: now, calendar: calendar))
    }

    func testTagsAnyMatch() {
        let filter = CustomFilterDefinition(name: "t", tagsAny: ["work", "urgent"])
        XCTAssertTrue(filter.matches(task(id: "a", title: "fix bug #work"), now: now, calendar: calendar))
        XCTAssertFalse(filter.matches(task(id: "b", title: "read book #personal"), now: now, calendar: calendar))
    }

    func testListRestriction() {
        let filter = CustomFilterDefinition(name: "l", taskListIDs: ["L1"])
        XCTAssertTrue(filter.matches(task(id: "a", list: "L1"), now: now, calendar: calendar))
        XCTAssertFalse(filter.matches(task(id: "b", list: "L2"), now: now, calendar: calendar))
    }
}
