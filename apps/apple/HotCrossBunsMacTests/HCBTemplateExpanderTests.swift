import XCTest
@testable import HotCrossBunsMac

final class HCBTemplateExpanderTests: XCTestCase {
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private var now: Date {
        // 2026-04-18 was a Saturday (weekday 7). Picked so nextWeekday:mon is
        // +2 days and nextWeekday:sun is +1.
        calendar.date(from: DateComponents(year: 2026, month: 4, day: 18))!
    }

    private func ctx(clipboard: String? = nil, prompts: [String: String] = [:]) -> HCBTemplateContext {
        HCBTemplateContext(now: now, calendar: calendar, clipboard: clipboard, prompts: prompts)
    }

    // MARK: - literal passthrough

    func testLiteralUnchanged() {
        XCTAssertEqual(HCBTemplateExpander.expand("Hello world", context: ctx()), "Hello world")
    }

    func testUnknownVariableLeftVisible() {
        // Typo should stay visible so users see which placeholder failed.
        XCTAssertEqual(HCBTemplateExpander.expand("{{tody}}", context: ctx()), "{{tody}}")
    }

    func testUnmatchedOpenerLeftIntact() {
        XCTAssertEqual(HCBTemplateExpander.expand("Hi {{unclosed", context: ctx()), "Hi {{unclosed")
    }

    // MARK: - dates

    func testToday() {
        XCTAssertEqual(HCBTemplateExpander.expand("{{today}}", context: ctx()), "2026-04-18")
    }

    func testTomorrowYesterday() {
        XCTAssertEqual(HCBTemplateExpander.expand("{{tomorrow}}", context: ctx()), "2026-04-19")
        XCTAssertEqual(HCBTemplateExpander.expand("{{yesterday}}", context: ctx()), "2026-04-17")
    }

    func testRelativeDays() {
        XCTAssertEqual(HCBTemplateExpander.expand("{{+7d}}", context: ctx()), "2026-04-25")
        XCTAssertEqual(HCBTemplateExpander.expand("{{-3d}}", context: ctx()), "2026-04-15")
    }

    func testRelativeWeeksMonths() {
        XCTAssertEqual(HCBTemplateExpander.expand("{{+2w}}", context: ctx()), "2026-05-02")
        // Month math in the gregorian calendar — adding 1 month to April 18 lands on May 18.
        XCTAssertEqual(HCBTemplateExpander.expand("{{+1m}}", context: ctx()), "2026-05-18")
    }

    func testNextWeekdayAdvancesPastToday() {
        // now = Saturday. nextWeekday:sat should be NEXT saturday (7 days), not today.
        XCTAssertEqual(HCBTemplateExpander.expand("{{nextWeekday:sat}}", context: ctx()), "2026-04-25")
        // sun → +1, mon → +2
        XCTAssertEqual(HCBTemplateExpander.expand("{{nextWeekday:sun}}", context: ctx()), "2026-04-19")
        XCTAssertEqual(HCBTemplateExpander.expand("{{nextWeekday:mon}}", context: ctx()), "2026-04-20")
    }

    func testNextWeekdayCaseInsensitive() {
        XCTAssertEqual(HCBTemplateExpander.expand("{{nextWeekday:MON}}", context: ctx()), "2026-04-20")
    }

    // MARK: - clipboard / cursor / prompt

    func testClipboardInsertion() {
        XCTAssertEqual(HCBTemplateExpander.expand("paste:{{clipboard}}", context: ctx(clipboard: "hello")),
                       "paste:hello")
    }

    func testClipboardEmptyWhenNil() {
        XCTAssertEqual(HCBTemplateExpander.expand("paste:{{clipboard}}!", context: ctx()), "paste:!")
    }

    func testCursorSentinelInserted() {
        let out = HCBTemplateExpander.expand("before {{cursor}} after", context: ctx())
        XCTAssertTrue(out.contains(HCBTemplateExpander.cursorSentinel))
    }

    func testPromptSubstitution() {
        let out = HCBTemplateExpander.expand("Owner: {{prompt:Owner}}", context: ctx(prompts: ["Owner": "Alice"]))
        XCTAssertEqual(out, "Owner: Alice")
    }

    func testPromptMissingLeftVisible() {
        // Unanswered prompt stays as literal {{prompt:Owner}} so the user sees the gap.
        let out = HCBTemplateExpander.expand("Owner: {{prompt:Owner}}", context: ctx())
        XCTAssertEqual(out, "Owner: {{prompt:Owner}}")
    }

    // MARK: - combined

    func testMixedTemplate() {
        let out = HCBTemplateExpander.expand(
            "Due {{+7d}} — owner {{prompt:Owner}}",
            context: ctx(prompts: ["Owner": "Alice"])
        )
        XCTAssertEqual(out, "Due 2026-04-25 — owner Alice")
    }

    // MARK: - TaskTemplate.requiredPrompts

    func testRequiredPromptsAggregates() {
        let t = TaskTemplate(
            id: UUID(),
            name: "Weekly review",
            title: "Review {{prompt:Week}}",
            notes: "Owned by {{prompt:Owner}}",
            due: "{{today}}",
            listIdOrTitle: ""
        )
        XCTAssertEqual(Set(t.requiredPrompts()), ["Week", "Owner"])
    }

    func testRequiredPromptsDedupesAcrossFields() {
        let t = TaskTemplate(
            id: UUID(),
            name: "x",
            title: "{{prompt:Owner}}",
            notes: "cc {{prompt:Owner}}",
            due: "",
            listIdOrTitle: ""
        )
        XCTAssertEqual(t.requiredPrompts(), ["Owner"])
    }
}
