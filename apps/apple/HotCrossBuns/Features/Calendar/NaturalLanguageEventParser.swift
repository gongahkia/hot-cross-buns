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
        // Most-specific first: compound "for 1h 30m" before plain units
        // before word-based durations. Each resolver returns minutes.
        let patterns: [(String, (NSTextCheckingResult, String) -> Int?)] = [
            // for 1h 30m  /  1h 30m
            ("\\b(?:for\\s+)?(\\d{1,3})\\s*h(?:r|rs|our|ours)?\\s*(\\d{1,2})\\s*m(?:in|ins|inute|inutes)?\\b", { match, text in
                guard let r1 = Range(match.range(at: 1), in: text), let h = Int(text[r1]),
                      let r2 = Range(match.range(at: 2), in: text), let m = Int(text[r2]) else { return nil }
                return h * 60 + m
            }),
            // for 1.5h / 1.5 hours / 1.5hr
            ("\\b(?:for\\s+)?(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|h)\\b", { match, text in
                guard let r = Range(match.range(at: 1), in: text),
                      let n = Double(text[r]) else { return nil }
                return Int((n * 60).rounded())
            }),
            // for 90 min / 90 minutes / 90m
            ("\\b(?:for\\s+)?(\\d{1,3})\\s*(min|mins|minutes?|m)\\b", { match, text in
                guard let r = Range(match.range(at: 1), in: text), let n = Int(text[r]) else { return nil }
                return n
            }),
            // half an hour / half hour
            ("\\bhalf\\s+an?\\s*hour\\b", { _, _ in 30 }),
            ("\\bhalf\\s+hour\\b", { _, _ in 30 }),
            // quarter of an hour / quarter hour
            ("\\bquarter\\s+(?:of\\s+)?an?\\s*hour\\b", { _, _ in 15 }),
            ("\\bquarter\\s+hour\\b", { _, _ in 15 })
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

        // Try time patterns in decreasing specificity. Each returns
        // (hour24, minute, NSRange-in-original-text). First hit wins.
        if let hit = matchTime(lower: lower, text: text) {
            let base = dayAnchor?.date ?? calendar.startOfDay(for: now)
            var comps = calendar.dateComponents([.year, .month, .day], from: base)
            comps.hour = hit.hour
            comps.minute = hit.minute
            guard let resolved = calendar.date(from: comps) else { return nil }
            var working = text
            if let dayRange = dayAnchor?.range {
                working.removeSubrange(dayRange)
            }
            if let timeRange = Range(hit.range, in: working) {
                working.removeSubrange(timeRange)
            }
            let formatter = DateFormatter()
            formatter.calendar = calendar
            formatter.dateFormat = dayAnchor == nil ? "h:mm a" : "EEE h:mm a"
            return (resolved, false, working, formatter.string(from: resolved))
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

    private struct TimeHit {
        let hour: Int   // 0..23
        let minute: Int // 0..59
        let range: NSRange // in lower/text (identical length)
    }

    private func matchTime(lower: String, text: String) -> TimeHit? {
        // noon / midnight keywords first.
        if let hit = firstMatch(pattern: "\\bnoon\\b", in: lower) {
            return TimeHit(hour: 12, minute: 0, range: hit.range)
        }
        if let hit = firstMatch(pattern: "\\bmidnight\\b", in: lower) {
            return TimeHit(hour: 0, minute: 0, range: hit.range)
        }
        // AM/PM with optional minutes: 9am, 9:30pm, 12 p.m.
        if let regex = try? NSRegularExpression(pattern: "\\b(\\d{1,2})(?::(\\d{2}))?\\s*(a|p)\\.?m\\.?\\b"),
           let match = regex.firstMatch(in: lower, range: NSRange(lower.startIndex..., in: lower)),
           let hRange = Range(match.range(at: 1), in: lower),
           let ampmRange = Range(match.range(at: 3), in: lower),
           let hour12 = Int(lower[hRange])
        {
            let minute: Int = {
                if let mRange = Range(match.range(at: 2), in: lower), let m = Int(lower[mRange]) { return m }
                return 0
            }()
            let isPM = lower[ampmRange] == "p"
            var hour24 = hour12 % 12
            if isPM { hour24 += 12 }
            return TimeHit(hour: hour24, minute: minute, range: match.range)
        }
        // 24-hour HH:MM. Require a colon to avoid colliding with bare
        // numbers like "5 days".
        if let regex = try? NSRegularExpression(pattern: "\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b"),
           let match = regex.firstMatch(in: lower, range: NSRange(lower.startIndex..., in: lower)),
           let hRange = Range(match.range(at: 1), in: lower),
           let mRange = Range(match.range(at: 2), in: lower),
           let h = Int(lower[hRange]),
           let m = Int(lower[mRange])
        {
            return TimeHit(hour: h, minute: m, range: match.range)
        }
        return nil
    }

    private func firstMatch(pattern: String, in text: String) -> NSTextCheckingResult? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        return regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    }

    private struct DayAnchor {
        let date: Date
        let range: Range<String.Index>
    }

    private func extractDayAnchor(in lower: String, text: String) -> DayAnchor? {
        // ISO date must precede the numeric M-D pattern.
        let patterns: [(String, (NSTextCheckingResult) -> Date?)] = [
            ("\\beod\\b", { _ in self.calendar.startOfDay(for: self.now) }),
            ("\\beow\\b", { _ in self.resolveEndOfWeek() }),
            ("\\beom\\b", { _ in self.resolveEndOfMonth() }),
            ("\\beoy\\b", { _ in self.resolveEndOfYear() }),
            ("\\b(today|tdy|td|tnt|tonight)\\b", { _ in self.calendar.startOfDay(for: self.now) }),
            ("\\b(tomorrow|tmrw|tmr|tmw|tomo|2mrw|2moro|2mro)\\b", { _ in self.calendar.date(byAdding: .day, value: 1, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\b(yesterday|ytd|yday)\\b", { _ in self.calendar.date(byAdding: .day, value: -1, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\b(day\\s+after\\s+tomorrow|dat)\\b", { _ in self.calendar.date(byAdding: .day, value: 2, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\bin\\s+(\\d{1,3})\\s+(hour|hours|hr|hrs|day|days|d|week|weeks|wk|wks|month|months|mo)\\b", { match in
                guard let r1 = Range(match.range(at: 1), in: lower),
                      let r2 = Range(match.range(at: 2), in: lower),
                      let n = Int(lower[r1]) else { return nil }
                let unit = String(lower[r2])
                let today = self.calendar.startOfDay(for: self.now)
                if ["hour", "hours", "hr", "hrs"].contains(unit) {
                    return self.calendar.date(byAdding: .hour, value: n, to: Date())
                }
                if ["week", "weeks", "wk", "wks"].contains(unit) {
                    return self.calendar.date(byAdding: .day, value: n * 7, to: today)
                }
                if ["month", "months", "mo"].contains(unit) {
                    return self.calendar.date(byAdding: .month, value: n, to: today)
                }
                return self.calendar.date(byAdding: .day, value: n, to: today)
            }),
            ("\\b(next\\s+week|nw)\\b", { _ in self.calendar.date(byAdding: .day, value: 7, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\b(next\\s+month|nm)\\b", { _ in self.calendar.date(byAdding: .month, value: 1, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\b(next\\s+year|ny)\\b", { _ in self.calendar.date(byAdding: .year, value: 1, to: self.calendar.startOfDay(for: self.now)) }),
            ("\\b(this\\s+)?weekend\\b", { _ in self.resolveWeekday("sat") }),
            ("\\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mo|tu|we|th|fr|sa|su)\\b", { match in
                guard let r = Range(match.range(at: 1), in: lower) else { return nil }
                return self.resolveWeekday(String(lower[r]))
            }),
            ("\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b", { match in
                guard let r1 = Range(match.range(at: 1), in: lower),
                      let r2 = Range(match.range(at: 2), in: lower),
                      let day = Int(lower[r2]) else { return nil }
                return self.resolveMonthDay(monthText: String(lower[r1]), day: day)
            }),
            ("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\\b", { match in
                guard let r1 = Range(match.range(at: 1), in: lower),
                      let r2 = Range(match.range(at: 2), in: lower),
                      let day = Int(lower[r1]) else { return nil }
                return self.resolveMonthDay(monthText: String(lower[r2]), day: day)
            }),
            ("\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b", { match in
                guard let yR = Range(match.range(at: 1), in: lower),
                      let mR = Range(match.range(at: 2), in: lower),
                      let dR = Range(match.range(at: 3), in: lower),
                      let y = Int(lower[yR]), let m = Int(lower[mR]), let d = Int(lower[dR]) else { return nil }
                return self.resolveISODate(year: y, month: m, day: d)
            }),
            ("\\b(\\d{1,2})[/.\\-](\\d{1,2})\\b", { match in
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
            case "sun", "sunday", "su": 1
            case "mon", "monday", "mo": 2
            case "tue", "tues", "tuesday", "tu": 3
            case "wed", "wednesday", "we": 4
            case "thu", "thur", "thurs", "thursday", "th": 5
            case "fri", "friday", "fr": 6
            case "sat", "saturday", "sa": 7
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

    private func resolveMonthDay(monthText: String, day: Int) -> Date? {
        let monthNumber = monthFrom(monthText: monthText)
        guard monthNumber > 0 else { return nil }
        return resolveMonthDay(month: monthNumber, day: day)
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

    private func resolveISODate(year: Int, month: Int, day: Int) -> Date? {
        guard (1...12).contains(month), (1...31).contains(day), year >= 1970 else { return nil }
        var comps = DateComponents(year: year, month: month, day: day)
        comps.hour = 0; comps.minute = 0; comps.second = 0
        return calendar.date(from: comps)
    }

    private func resolveEndOfWeek() -> Date? {
        let today = calendar.startOfDay(for: now)
        let weekday = calendar.component(.weekday, from: today)
        let rawDelta = 7 - weekday
        let delta = rawDelta == 0 ? 7 : rawDelta
        return calendar.date(byAdding: .day, value: delta, to: today)
    }

    private func resolveEndOfMonth() -> Date? {
        var comps = calendar.dateComponents([.year, .month], from: calendar.startOfDay(for: now))
        comps.month = (comps.month ?? 1) + 1
        comps.day = 0
        return calendar.date(from: comps)
    }

    private func resolveEndOfYear() -> Date? {
        var comps = calendar.dateComponents([.year], from: calendar.startOfDay(for: now))
        comps.month = 12
        comps.day = 31
        return calendar.date(from: comps)
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
