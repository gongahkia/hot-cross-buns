import XCTest
@testable import HotCrossBunsMac

final class CalendarObservationBoundaryTests: XCTestCase {
    func testCalendarSurfacesReadSurfaceStoresInsteadOfBroadAppModelData() throws {
        let files = [
            "apps/apple/HotCrossBuns/Features/Calendar/CalendarHomeView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/CalendarSidebarFilters.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/DayGridView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/WeekGridView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/MonthGridView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/YearGridView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/EventContextMenu.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/EventHoverPreview.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/QuickCreatePopover.swift"
        ]
        let forbiddenReads = [
            "model.calendars",
            "model.events",
            "model.calendarSnapshot",
            "model.visibleTaskListIDs",
            "model.settings",
            "model.syncState",
            "model.authState",
            "model.account",
            "model.lastMutationError",
            "model.event(",
            "model.task(",
            "model.eventsByDay",
            "model.tasksByDueDate",
            "model.cachedCalendar",
            "model.storeCalendar",
            "model.taskListTitle(",
            "model.taskLists"
        ]

        for file in files {
            let source = try String(contentsOf: repoRoot.appending(path: file))
            let uncommentedLines = source
                .components(separatedBy: .newlines)
                .map { line in
                    if let commentStart = line.range(of: "//")?.lowerBound {
                        return String(line[..<commentStart])
                    }
                    return line
                }
            let uncommentedSource = uncommentedLines.joined(separator: "\n")
            for forbiddenRead in forbiddenReads {
                XCTAssertFalse(
                    uncommentedSource.contains(forbiddenRead),
                    "\(file) should read \(forbiddenRead) through CalendarStore, TaskStore, or SettingsStore instead of AppModel."
                )
            }
        }
    }

    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}
