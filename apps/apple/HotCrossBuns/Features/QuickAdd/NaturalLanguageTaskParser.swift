import Foundation

struct ParsedQuickAddTask: Equatable, Sendable {
    var title: String
    var dueDate: Date?
    var taskListHint: String?
    var matchedTokens: [MatchedToken]

    struct MatchedToken: Equatable, Sendable {
        let kind: Kind
        let display: String

        enum Kind: Equatable, Sendable {
            case dueDate
            case list
        }
    }

    var hasParsedMetadata: Bool { matchedTokens.isEmpty == false }
}

struct NaturalLanguageTaskParser: Sendable {
    let calendar: Calendar
    let now: Date

    init(now: Date = Date(), calendar: Calendar = .current) {
        self.calendar = calendar
        self.now = now
    }

    func parse(_ input: String) -> ParsedQuickAddTask {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            return ParsedQuickAddTask(title: "", dueDate: nil, taskListHint: nil, matchedTokens: [])
        }

        var working = " \(trimmed) "
        var tokens: [ParsedQuickAddTask.MatchedToken] = []

        var taskListHint: String?
        if let (hint, replacement) = extractListHint(in: working) {
            taskListHint = hint
            working = replacement
            tokens.append(.init(kind: .list, display: "#\(hint)"))
        }

        var dueDate: Date?
        if let (date, replacement, display) = extractDueDate(in: working) {
            dueDate = date
            working = replacement
            tokens.append(.init(kind: .dueDate, display: display))
        }

        let cleanedTitle = working
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return ParsedQuickAddTask(
            title: cleanedTitle,
            dueDate: dueDate,
            taskListHint: taskListHint,
            matchedTokens: tokens
        )
    }

    private func extractListHint(in text: String) -> (String, String)? {
        let pattern = "#([A-Za-z0-9_\\-]{1,40})"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let fullRange = Range(match.range, in: text),
              let hintRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        let hint = String(text[hintRange])
        var replacement = text
        replacement.removeSubrange(fullRange)
        return (hint, replacement)
    }

    private func extractDueDate(in text: String) -> (Date, String, String)? {
        let lower = text.lowercased()

        let patterns: [(pattern: String, resolver: (NSTextCheckingResult, String) -> (Date, String)?)] = [
            ("\\b(today|tonight)\\b", { _, _ in
                self.resolveRelativeDay(offsetDays: 0, display: "Today")
            }),
            ("\\b(tomorrow|tmr|tmrw)\\b", { _, _ in
                self.resolveRelativeDay(offsetDays: 1, display: "Tomorrow")
            }),
            ("\\bin\\s+(\\d{1,3})\\s+(day|days|week|weeks)\\b", { match, text in
                guard let numberRange = Range(match.range(at: 1), in: text),
                      let unitRange = Range(match.range(at: 2), in: text),
                      let n = Int(text[numberRange]) else { return nil }
                let unit = text[unitRange].lowercased()
                let multiplier = (unit == "week" || unit == "weeks") ? 7 : 1
                let days = n * multiplier
                let display = "In \(n) \(unit.capitalized)"
                return self.resolveRelativeDay(offsetDays: days, display: display)
            }),
            ("\\bnext\\s+(week)\\b", { _, _ in
                self.resolveRelativeDay(offsetDays: 7, display: "Next week")
            }),
            ("\\b(next\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\\b", { match, text in
                guard let weekdayRange = Range(match.range(at: 2), in: text) else { return nil }
                let weekdayText = String(text[weekdayRange]).lowercased()
                let forceNext = match.range(at: 1).location != NSNotFound
                return self.resolveWeekday(weekdayText: weekdayText, forceNext: forceNext)
            }),
            ("\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b", { match, text in
                guard let monthRange = Range(match.range(at: 1), in: text),
                      let dayRange = Range(match.range(at: 2), in: text),
                      let day = Int(text[dayRange]) else { return nil }
                return self.resolveMonthDay(monthText: String(text[monthRange]), day: day)
            }),
            ("\\b(\\d{1,2})\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\\b", { match, text in
                guard let dayRange = Range(match.range(at: 1), in: text),
                      let monthRange = Range(match.range(at: 2), in: text),
                      let day = Int(text[dayRange]) else { return nil }
                return self.resolveMonthDay(monthText: String(text[monthRange]), day: day)
            }),
            ("\\b(\\d{1,2})[/-](\\d{1,2})\\b", { match, text in
                guard let mRange = Range(match.range(at: 1), in: text),
                      let dRange = Range(match.range(at: 2), in: text),
                      let monthNumber = Int(text[mRange]),
                      let dayNumber = Int(text[dRange]) else { return nil }
                return self.resolveMonthDayNumeric(month: monthNumber, day: dayNumber)
            })
        ]

        for (pattern, resolver) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(lower.startIndex..., in: lower)
            guard let match = regex.firstMatch(in: lower, range: range),
                  let fullRange = Range(match.range, in: text) else {
                continue
            }
            if let (date, display) = resolver(match, lower) {
                var replacement = text
                replacement.removeSubrange(fullRange)
                return (date, replacement, display)
            }
        }
        return nil
    }

    private func resolveRelativeDay(offsetDays: Int, display: String) -> (Date, String)? {
        let today = calendar.startOfDay(for: now)
        guard let date = calendar.date(byAdding: .day, value: offsetDays, to: today) else { return nil }
        return (date, display)
    }

    private func resolveWeekday(weekdayText: String, forceNext: Bool) -> (Date, String)? {
        let weekdayIndex: Int = {
            switch weekdayText {
            case "sun": return 1
            case "mon": return 2
            case "tue", "tues": return 3
            case "wed": return 4
            case "thu", "thur", "thurs": return 5
            case "fri": return 6
            case "sat": return 7
            case "sunday": return 1
            case "monday": return 2
            case "tuesday": return 3
            case "wednesday": return 4
            case "thursday": return 5
            case "friday": return 6
            case "saturday": return 7
            default: return 0
            }
        }()
        guard weekdayIndex > 0 else { return nil }

        let today = calendar.startOfDay(for: now)
        let todayWeekday = calendar.component(.weekday, from: today)
        var delta = weekdayIndex - todayWeekday
        if delta <= 0 { delta += 7 }
        if forceNext && delta < 7 { delta += 0 }
        guard let target = calendar.date(byAdding: .day, value: delta, to: today) else { return nil }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.dateFormat = "EEEE"
        let label = (forceNext ? "Next " : "") + formatter.string(from: target)
        return (target, label.capitalized)
    }

    private func resolveMonthDay(monthText: String, day: Int) -> (Date, String)? {
        let monthNumber = monthFrom(monthText: monthText)
        guard monthNumber > 0 else { return nil }
        return resolveMonthDayNumeric(month: monthNumber, day: day)
    }

    private func resolveMonthDayNumeric(month: Int, day: Int) -> (Date, String)? {
        guard (1...12).contains(month), (1...31).contains(day) else { return nil }
        let year = calendar.component(.year, from: now)
        var components = DateComponents(year: year, month: month, day: day)
        guard let candidate = calendar.date(from: components) else { return nil }
        let today = calendar.startOfDay(for: now)
        let finalDate: Date
        if candidate < today {
            components.year = year + 1
            guard let bumped = calendar.date(from: components) else { return nil }
            finalDate = bumped
        } else {
            finalDate = candidate
        }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.dateFormat = "MMM d"
        return (finalDate, formatter.string(from: finalDate))
    }

    private func monthFrom(monthText: String) -> Int {
        switch monthText.lowercased() {
        case "jan", "january": 1
        case "feb", "february": 2
        case "mar", "march": 3
        case "apr", "april": 4
        case "may": 5
        case "jun", "june": 6
        case "jul", "july": 7
        case "aug", "august": 8
        case "sep", "sept", "september": 9
        case "oct", "october": 10
        case "nov", "november": 11
        case "dec", "december": 12
        default: 0
        }
    }
}
