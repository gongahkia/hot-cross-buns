import XCTest
@testable import HotCrossBunsMac

final class SmartListFilterTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private var now: Date {
        calendar.date(from: DateComponents(year: 2026, month: 4, day: 18, hour: 15))!
    }

    private func task(
        id: String,
        title: String = "t",
        due: Date? = nil,
        completed: Bool = false,
        deleted: Bool = false,
        list: String = "L1"
    ) -> TaskMirror {
        TaskMirror(
            id: id,
            taskListID: list,
            parentID: nil,
            title: title,
            notes: "",
            status: completed ? .completed : .needsAction,
            dueDate: due,
            completedAt: completed ? now : nil,
            isDeleted: deleted,
            isHidden: false,
            position: nil,
            etag: nil,
            updatedAt: nil
        )
    }

    private func day(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now))!
    }

    func testOverdueExcludesCompletedAndDeleted() {
        let tasks = [
            task(id: "1", due: day(-1)),
            task(id: "2", due: day(-2), completed: true),
            task(id: "3", due: day(-3), deleted: true),
            task(id: "4", due: day(-1)),
            task(id: "5", due: day(0))
        ]
        let result = SmartListFilter.overdue.apply(to: tasks, now: now, calendar: calendar)
        XCTAssertEqual(result.map(\.id), ["1", "4"])
    }

    func testDueTodayIncludesOnlyStartOfToday() {
        let tasks = [
            task(id: "today", due: day(0)),
            task(id: "tomorrow", due: day(1)),
            task(id: "yesterday", due: day(-1)),
            task(id: "later-today", due: calendar.date(byAdding: .hour, value: 20, to: day(0))!)
        ]
        let result = SmartListFilter.dueToday.apply(to: tasks, now: now, calendar: calendar)
        XCTAssertEqual(Set(result.map(\.id)), ["today", "later-today"])
    }

    func testNext7DaysExcludesTodayAndSeventhDay() {
        let tasks = [
            task(id: "today", due: day(0)),
            task(id: "one", due: day(1)),
            task(id: "six", due: day(6)),
            task(id: "seven", due: day(7)),
            task(id: "eight", due: day(8))
        ]
        let result = SmartListFilter.next7Days.apply(to: tasks, now: now, calendar: calendar)
        XCTAssertEqual(result.map(\.id), ["today", "one", "six"])
    }

    func testNoDateReturnsTasksWithoutDueDate() {
        let tasks = [
            task(id: "a", due: nil),
            task(id: "b", due: day(1)),
            task(id: "c", due: nil, completed: true),
            task(id: "d", due: nil)
        ]
        let result = SmartListFilter.noDate.apply(to: tasks, now: now, calendar: calendar)
        XCTAssertEqual(Set(result.map(\.id)), ["a", "d"])
    }

    func testApplySortsByDueDateAscending() {
        let tasks = [
            task(id: "late", due: day(5)),
            task(id: "early", due: day(1)),
            task(id: "mid", due: day(3))
        ]
        let result = SmartListFilter.next7Days.apply(to: tasks, now: now, calendar: calendar)
        XCTAssertEqual(result.map(\.id), ["early", "mid", "late"])
    }

    func testCountMatchesApplyCount() {
        let tasks = [
            task(id: "a", due: day(-1)),
            task(id: "b", due: day(-5)),
            task(id: "c", due: day(0))
        ]
        XCTAssertEqual(
            SmartListFilter.overdue.count(in: tasks, now: now, calendar: calendar),
            SmartListFilter.overdue.apply(to: tasks, now: now, calendar: calendar).count
        )
    }
}
