import XCTest
@testable import HotCrossBunsMac

final class TaskStarringTests: XCTestCase {
    private func task(title: String) -> TaskMirror {
        TaskMirror(
            id: "t",
            taskListID: "L",
            parentID: nil,
            title: title,
            notes: "",
            status: .needsAction,
            dueDate: nil,
            completedAt: nil,
            isDeleted: false,
            isHidden: false,
            position: nil,
            etag: nil,
            updatedAt: nil
        )
    }

    func testIsStarredDetectsPrefix() {
        XCTAssertTrue(TaskStarring.isStarred(task(title: "⭐ Ship the thing")))
        XCTAssertFalse(TaskStarring.isStarred(task(title: "Ship the thing")))
        XCTAssertFalse(TaskStarring.isStarred(task(title: "⭐Ship")), "Missing trailing space should not count")
    }

    func testDisplayTitleStripsStar() {
        XCTAssertEqual(TaskStarring.displayTitle(for: task(title: "⭐ Ship the thing")), "Ship the thing")
        XCTAssertEqual(TaskStarring.displayTitle(for: task(title: "Ship the thing")), "Ship the thing")
    }

    func testToggledTitleAddsAndRemoves() {
        let plain = task(title: "Ship the thing")
        XCTAssertEqual(TaskStarring.toggledTitle(for: plain), "⭐ Ship the thing")
        let starred = task(title: "⭐ Ship the thing")
        XCTAssertEqual(TaskStarring.toggledTitle(for: starred), "Ship the thing")
    }

    func testToggleIsIdempotentRoundTrip() {
        let start = task(title: "Plan trip")
        let once = TaskStarring.toggledTitle(for: start)
        let twice = TaskStarring.toggledTitle(for: task(title: once))
        XCTAssertEqual(twice, start.title)
    }
}
