import XCTest
@testable import MelonPan

@MainActor
final class HelpViewModelTests: XCTestCase {
    func testAllHelpAssetsLoad() async {
        let model = HelpViewModel()
        await model.preload()

        XCTAssertTrue(model.loadFailures.isEmpty)
        for category in HelpCategory.all {
            XCTAssertFalse(String(model.body(for: category).characters).isEmpty, category.id)
        }
    }

    func testSearchHitsFindExpectedCategories() async {
        let model = HelpViewModel()
        await model.preload()

        let cases: [(String, String)] = [
            ("palette", HelpCategory.shortcuts.id),
            ("yank", HelpCategory.vim.id),
            ("conflict", HelpCategory.sync.id),
            ("drive", HelpCategory.drive.id),
            ("⌘N", HelpCategory.shortcuts.id)
        ]

        for (query, categoryId) in cases {
            model.query = query
            XCTAssertTrue(
                model.searchHits().contains { $0.category.id == categoryId },
                "\(query) should find \(categoryId)"
            )
        }
    }

    func testShortcutTableMatchUsesCommandChordAndDescription() {
        let entry = ShortcutEntry(
            command: "Open command palette",
            chord: "⌘P",
            description: "Search commands and documents."
        )

        XCTAssertTrue(ShortcutTable.matches(entry, highlight: "palette"))
        XCTAssertTrue(ShortcutTable.matches(entry, highlight: "⌘P"))
        XCTAssertTrue(ShortcutTable.matches(entry, highlight: "documents"))
        XCTAssertFalse(ShortcutTable.matches(entry, highlight: "conflict"))
        XCTAssertFalse(ShortcutTable.matches(entry, highlight: ""))
    }
}
