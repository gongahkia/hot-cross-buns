import SwiftUI
import XCTest
@testable import HotCrossBunsMac

final class AccessibilityFoundationsTests: XCTestCase {
    func testDynamicTypeScaleIsMonotonicAndKeepsLargeAtBaseline() {
        XCTAssertEqual(HCBTextSize.dynamicTypeScale(for: .large), 1.0, accuracy: 0.001)

        let sizes: [DynamicTypeSize] = [
            .xSmall,
            .small,
            .medium,
            .large,
            .xLarge,
            .xxLarge,
            .xxxLarge,
            .accessibility1,
            .accessibility2,
            .accessibility3,
            .accessibility4,
            .accessibility5
        ]

        let scales = sizes.map(HCBTextSize.dynamicTypeScale(for:))
        XCTAssertEqual(scales, scales.sorted(), "Dynamic Type scale should never shrink as the system size increases.")
        XCTAssertGreaterThan(HCBTextSize.dynamicTypeScale(for: .accessibility5), HCBTextSize.dynamicTypeScale(for: .large))
    }

    func testReduceMotionIsUsedByAnimatedSurfaces() throws {
        let files = [
            "apps/apple/HotCrossBuns/Design/HCBAppearance.swift",
            "apps/apple/HotCrossBuns/Design/LoadingView.swift",
            "apps/apple/HotCrossBuns/Design/UndoToast.swift",
            "apps/apple/HotCrossBuns/Design/BulkResultToast.swift",
            "apps/apple/HotCrossBuns/Design/DeepLinkErrorToast.swift",
            "apps/apple/HotCrossBuns/App/MacSidebarShell.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/CalendarHomeView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/DayGridView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/WeekGridView.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/MonthGridView.swift",
            "apps/apple/HotCrossBuns/Features/Store/StoreView.swift",
            "apps/apple/HotCrossBuns/Features/Store/KanbanView.swift",
            "apps/apple/HotCrossBuns/Features/QuickAdd/QuickAddView.swift",
            "apps/apple/HotCrossBuns/Features/QuickAdd/QuickAddEventView.swift"
        ]

        for file in files {
            let source = try String(contentsOf: repoRoot.appending(path: file))
            XCTAssertTrue(
                source.contains("accessibilityReduceMotion") || source.contains("HCBMotion."),
                "\(file) should branch animation behavior through reduce-motion."
            )
        }
    }

    func testCoreInteractiveSurfacesHaveVoiceOverLabels() throws {
        let monthGrid = try String(contentsOf: repoRoot.appending(path: "apps/apple/HotCrossBuns/Features/Calendar/MonthGridView.swift"))
        XCTAssertTrue(monthGrid.contains("monthCellAccessibilityLabel"))
        XCTAssertTrue(monthGrid.contains(".accessibilityElement(children: .combine)"))
        XCTAssertTrue(monthGrid.contains(".accessibilityLabel(monthCellAccessibilityLabel"))

        let kanban = try String(contentsOf: repoRoot.appending(path: "apps/apple/HotCrossBuns/Features/Store/KanbanView.swift"))
        XCTAssertTrue(kanban.contains("taskAccessibilityLabel"))
        XCTAssertTrue(kanban.contains("completedTaskAccessibilityLabel"))
        XCTAssertTrue(kanban.contains(".accessibilityLabel(\"Tag \\(tag)\")"))

        let notes = try String(contentsOf: repoRoot.appending(path: "apps/apple/HotCrossBuns/Features/Store/StoreView.swift"))
        XCTAssertTrue(notes.contains("noteAccessibilityLabel"))
        XCTAssertTrue(notes.contains(".accessibilityLabel(noteAccessibilityLabel)"))
    }

    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}
