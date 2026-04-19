import Foundation

struct ParsedQuickAddEvent: Equatable, Sendable {
    var summary: String
    var startDate: Date?
    var endDate: Date?
    var location: String?
    var isAllDay: Bool
    var matchedTokens: [MatchedToken]

    struct MatchedToken: Equatable, Sendable {
        let kind: Kind
        let display: String

        enum Kind: Equatable, Sendable {
            case startTime
            case duration
            case location
            case allDay
        }
    }

    var hasParsedMetadata: Bool { matchedTokens.isEmpty == false }
}

struct NaturalLanguageEventParser: Sendable {
    let calendar: Calendar
    let now: Date

    init(now: Date = Date(), calendar: Calendar = .current) {
        self.calendar = calendar
        self.now = now
    }

    func parse(_ input: String) -> ParsedQuickAddEvent {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            return ParsedQuickAddEvent(summary: "", startDate: nil, endDate: nil, location: nil, isAllDay: false, matchedTokens: [])
        }

        var working = " \(trimmed) "
        var tokens: [ParsedQuickAddEvent.MatchedToken] = []

        var location: String?
        if let (loc, replacement) = extractLocation(in: working) {
            location = loc
            working = replacement
            tokens.append(.init(kind: .location, display: "@\(loc)"))
        }

        var durationMinutes: Int?
        if let (mins, replacement, display) = extractDuration(in: working) {
            durationMinutes = mins
            working = replacement
            tokens.append(.init(kind: .duration, display: display))
        }

        var startDate: Date?
        var isAllDay = false
        if let (date, allDay, replacement, display) = extractStart(in: working) {
            startDate = date
            isAllDay = allDay
            working = replacement
            tokens.append(.init(kind: .startTime, display: display))
            if allDay {
                tokens.append(.init(kind: .allDay, display: "All-day"))
            }
        }

        let cleanedSummary = working
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let endDate: Date? = {
            guard let start = startDate else { return nil }
            if isAllDay { return start }
            let minutes = durationMinutes ?? 60
            return calendar.date(byAdding: .minute, value: minutes, to: start)
        }()

        return ParsedQuickAddEvent(
            summary: cleanedSummary,
            startDate: startDate,
            endDate: endDate,
            location: location,
            isAllDay: isAllDay,
            matchedTokens: tokens
        )
    }

    private func extractLocation(in text: String) -> (String, String)? {
        let pattern = "\\s(?:@|at\\s+)([A-Za-z][A-Za-z0-9 '&\\-]{1,40})(?=\\s|$)"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let fullRange = Range(match.range, in: text),
              let locRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        let raw = String(text[locRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard raw.isEmpty == false else { return nil }
        var replacement = text
        replacement.removeSubrange(fullRange)
        return (raw, replacement)
    }

    private func extractDuration(in text: String) -> (Int, String, String)? {
        let patterns: [(String, (NSTextCheckingResult, String) -> Int?)] = [
            ("\\bfor\\s+(\\d{1,3})\\s*(hours?|hrs?|h)\\b", { match, text in
                guard let r = Range(match.range(at: 1), in: text), let n = Int(text[r]) else { return nil }
                return n * 60
            }),
            ("\\bfor\\s+(\\d{1,3})\\s*(min|mins|minutes?)\\b", { match, text in
                guard let r = Range(match.range(at: 1), in: text), let n = Int(text[r]) else { return nil }
                return n
            }),
            ("\\bfor\\s+(\\d{1,3})\\s*h\\s*(\\d{1,2})\\s*m\\b", { match, text in
                guard let r1 = Range(match.range(at: 1), in: text), let h = Int(text[r1]),
                      let r2 = Range(match.range(at: 2), in: text), let m = Int(text[r2]) else { return nil }
                return h * 60 + m
            })
        ]
        let lower = text.lowercased()
        for (pattern, resolver) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(lower.startIndex..., in: lower)
            guard let match = regex.firstMatch(in: lower, range: range),
                  let fullRange = Range(match.range, in: text),
                  let mins = resolver(match, lower) else {
                continue
            }
            var replacement = text
            replacement.removeSubrange(fullRange)
            let display = mins >= 60 ? "\(mins / 60)h\(mins % 60 == 0 ? "" : " \(mins % 60)m")" : "\(mins)m"
            return (mins, replacement, display)
        }
        return nil
    }

    private func extractStart(in text: String) -> (Date, Bool, String, String)? {
        let lower = text.lowercased()
        let dayAnchor = extractDayAnchor(in: lower, text: text)

        let timePattern = "\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b"
        if let regex = try? NSRegularExpression(pattern: timePattern) {
            let range = NSRange(lower.startIndex..., in: lower)
            if let match = regex.firstMatch(in: lower, range: range),
               let fullRange = Range(match.range, in: text),
               let hRange = Range(match.range(at: 1), in: lower),
               let ampmRange = Range(match.range(at: 3), in: lower),
               let hour12 = Int(lower[hRange]) {
                let minute: Int = {
                    if let mRange = Range(match.range(at: 2), in: lower), let m = Int(lower[mRange]) { return m }
                    return 0
                }()
                let isPM = lower[ampmRange] == "pm"
                var hour24 = hour12 % 12
                if isPM { hour24 += 12 }
                let base = dayAnchor?.date ?? calendar.startOfDay(for: now)
                var comps = calendar.dateComponents([.year, .month, .day], from: base)
                comps.hour = hour24
                comps.minute = minute
                guard let resolved = calendar.date(from: comps) else { return nil }
                var working = text
                if let dayRange = dayAnchor?.range {
                    working.removeSubrange(dayRange)
                }
                if let timeRange = Range(match.range, in: working) {
                    working.removeSubrange(timeRange)
                }
                let formatter = DateFormatter()
                formatter.calendar = calendar
                formatter.dateFormat = dayAnchor == nil ? "h:mm a" : "EEE h:mm a"
                let display = formatter.string(from: resolved)
                return (resolved, false, working, display)
            }
        }

        if let anchor = dayAnchor {
            let formatter = DateFormatter()
            formatter.calendar = calendar
            formatter.dateFormat = "EEE MMM d"
            var working = text
            working.removeSubrange(anchor.range)
            return (anchor.date, true, working, formatter.string(from: anchor.date))
        }
        return nil
    }

    private struct DayAnchor {
        let date: Date
        let range: Range<String.Index>
    }

    private func extractDayAnchor(in lower: String, text: String) -> DayAnchor? {
        let patterns: [(String, (NSTextCheckingResult) -> Date?)] = [
            ("\\b(today|tonight)\\b", { _ in self.calendar.startOfDay(for: self.now) }),
            ("\\b(tomorrow|tmr|tmrw)\\b", { _ in self.calendar.date(byAdding: .day, value: 1, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b", { match in
                guard let r = Range(match.range(at: 1), in: lower) else { return nil }
                return self.resolveWeekday(String(lower[r]))
            }),
            ("\\b(\\d{1,2})[/-](\\d{1,2})\\b", { match in
                guard let r1 = Range(match.range(at: 1), in: lower), let m = Int(lower[r1]),
                      let r2 = Range(match.range(at: 2), in: lower), let d = Int(lower[r2]) else { return nil }
                return self.resolveMonthDay(month: m, day: d)
            })
        ]
        for (pattern, resolver) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(lower.startIndex..., in: lower)
            guard let match = regex.firstMatch(in: lower, range: range),
                  let date = resolver(match),
                  let textRange = Range(match.range, in: text) else { continue }
            return DayAnchor(date: date, range: textRange)
        }
        return nil
    }

    private func resolveWeekday(_ text: String) -> Date? {
        let weekdayIndex: Int = {
            switch text {
            case "sun", "sunday": 1
            case "mon", "monday": 2
            case "tue", "tues", "tuesday": 3
            case "wed", "wednesday": 4
            case "thu", "thur", "thurs", "thursday": 5
            case "fri", "friday": 6
            case "sat", "saturday": 7
            default: 0
            }
        }()
        guard weekdayIndex > 0 else { return nil }
        let today = calendar.startOfDay(for: now)
        let todayWeekday = calendar.component(.weekday, from: today)
        var delta = weekdayIndex - todayWeekday
        if delta <= 0 { delta += 7 }
        return calendar.date(byAdding: .day, value: delta, to: today)
    }

    private func resolveMonthDay(month: Int, day: Int) -> Date? {
        guard (1...12).contains(month), (1...31).contains(day) else { return nil }
        let year = calendar.component(.year, from: now)
        var components = DateComponents(year: year, month: month, day: day)
        guard let candidate = calendar.date(from: components) else { return nil }
        if candidate < calendar.startOfDay(for: now) {
            components.year = year + 1
            return calendar.date(from: components)
        }
        return candidate
    }
}
