import XCTest
@testable import HotCrossBunsMac

final class TaskReminderMarkersTests: XCTestCase {
    func testParseSingleOffset() {
        XCTAssertEqual(TaskReminderMarkers.offsetsInDays(from: "do it [reminders: 0]"), [0])
    }

    func testParseMultipleOffsets() {
        XCTAssertEqual(TaskReminderMarkers.offsetsInDays(from: "[reminders: 0, -1, -7]"), [0, -1, -7])
    }

    func testParseEmptyWhenAbsent() {
        XCTAssertEqual(TaskReminderMarkers.offsetsInDays(from: "just plain notes"), [])
    }

    func testStripRemovesMarker() {
        XCTAssertEqual(
            TaskReminderMarkers.strippedNotes(from: "first line\n[reminders: -1]"),
            "first line"
        )
    }

    func testEncodeReplacesMarker() {
        let original = "some text\n\n[reminders: -1]"
        let encoded = TaskReminderMarkers.encode(notes: original, offsetsInDays: [0, -2])
        XCTAssertTrue(encoded.contains("[reminders: -2, 0]"))
        XCTAssertTrue(encoded.contains("some text"))
        XCTAssertFalse(encoded.contains("[reminders: -1]"))
    }

    func testEncodeWithEmptyOffsetsStripsMarker() {
        let original = "body\n\n[reminders: -1]"
        XCTAssertEqual(TaskReminderMarkers.encode(notes: original, offsetsInDays: []), "body")
    }

    func testEncodeWithEmptyNotesAndOffsetsGivesMarkerOnly() {
        XCTAssertEqual(TaskReminderMarkers.encode(notes: "", offsetsInDays: [0]), "[reminders: 0]")
    }
}
